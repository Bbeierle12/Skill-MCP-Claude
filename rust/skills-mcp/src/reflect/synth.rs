use std::process::Command;
use std::path::{Path, PathBuf};
use std::fs;
use rusqlite::{Connection, params};

use super::{SynthesisJob, Mode};

/// Synthesizes a skill from a `SynthesisJob` by shelling out to the Claude CLI.
pub fn synthesize(conn: &Connection, job: &SynthesisJob, workspace_root: &Path) -> anyhow::Result<()> {
    // 1. Fetch representative logs (in-memory job already has rep_ids, we need their full text)
    // To keep it simple, we query them from the db
    let mut reps = Vec::new();
    for id in &job.rep_ids {
        let (ctx, cmd, err, fix): (String, Option<String>, Option<String>, Option<String>) = conn.query_row(
            "SELECT task_context, command, error_trace, resolution FROM experience_logs WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        reps.push(format!(
            "context: {}\ncommand: {}\nerror: {}\nfix: {}",
            ctx,
            cmd.as_deref().unwrap_or("UNKNOWN"),
            err.as_deref().unwrap_or("UNKNOWN"),
            fix.as_deref().unwrap_or("UNKNOWN")
        ));
    }

    // 2. Format the user prompt
    let mode_str = match job.mode {
        Mode::Create => "create",
        Mode::Update => "update",
    };
    
    let mut reps_text = String::new();
    for (i, rep) in reps.iter().enumerate() {
        reps_text.push_str(&format!("[{}]\n{}\n", i + 1, rep));
    }

    let proposed_name = job.target_skill.clone().unwrap_or_else(|| super::proposed_skill_name(&job.signature));

    // For updates, fetch the existing SKILL.md
    let mut existing_skill_content = String::new();
    if job.mode == Mode::Update {
        let skill_path = workspace_root.join("skills").join(&proposed_name).join("SKILL.md");
        if skill_path.exists() {
            existing_skill_content = fs::read_to_string(&skill_path)?;
        }
    }

    let user_prompt = format!(
        "MODE: {}\nCLUSTER_KEY: {}\nPROPOSED_NAME: {}\nNORMALIZED_SIGNATURES:\n  - {}\nDISTINCT_CONTEXTS: {}     RESOLUTION_GAP: {}\n\nREPRESENTATIVE LOGS ({}):\n{}\n\n{}",
        mode_str,
        job.cluster_key,
        proposed_name,
        job.signature,
        job.distinct_contexts,
        job.resolution_gap,
        reps.len(),
        reps_text,
        if job.mode == Mode::Update {
            format!("EXISTING SKILL.md:\n{}", existing_skill_content)
        } else {
            String::new()
        }
    );

    let system_prompt = r#"You are a Skill Compiler. You convert clusters of agent failure logs into a single
reusable skill that PREVENTS the failure next time. You are writing for other LLM
agents to read, not for humans. Be terse, imperative, and concrete.

OUTPUT CONTRACT — emit EXACTLY one fenced block per file, no prose outside them:

  ```file:SKILL.md
  <full SKILL.md following the AI-to-AI convention>
  ```
  ```file:_meta.json
  <valid _meta.json>
  ```
  ```file:scripts/verify.sh   (OPTIONAL — only if a precondition is checkable)
  <POSIX sh, exit 0 = ready, non-zero = not ready, remediation on stderr>
  ```
"#;

    let full_prompt = format!("{}\n\n{}", system_prompt, user_prompt);

    // 3. Shell out to Claude CLI
    // Note: core/claude_cli.py is in the workspace root
    let claude_cli_path = workspace_root.join("core").join("claude_cli.py");
    // Since claude_cli.py is a Python module, we can invoke python on it or directly call the executable if we rely on the `claude` binary in PATH
    // The spec says "shell out to the claude CLI". We will execute `claude -p full_prompt`
    // However, the spec also says "The LLM call reuses the existing core/claude_cli.py pattern".
    
    let output = Command::new("claude")
        .arg("-p")
        .arg(&full_prompt)
        .arg("--output-format")
        .arg("text")
        .current_dir(workspace_root)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        conn.execute(
            "UPDATE synthesis_jobs SET status = 'rejected', note = ?1 WHERE cluster_key = ?2",
            params![format!("Claude CLI failed: {}", stderr), job.cluster_key],
        )?;
        return Err(anyhow::anyhow!("Claude CLI failed"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // 4. Parse output
    let parsed = parse_files(&stdout);
    if !parsed.contains_key("SKILL.md") || !parsed.contains_key("_meta.json") {
        conn.execute(
            "UPDATE synthesis_jobs SET status = 'rejected', note = 'Missing SKILL.md or _meta.json in output' WHERE cluster_key = ?1",
            params![job.cluster_key],
        )?;
        return Err(anyhow::anyhow!("Missing required files in Claude output"));
    }

    // 5. Write to temp dir and validate
    let temp_dir = workspace_root.join("target").join(format!("reflect_{}", job.cluster_key));
    fs::create_dir_all(&temp_dir)?;
    
    fs::write(temp_dir.join("SKILL.md"), &parsed["SKILL.md"])?;
    fs::write(temp_dir.join("_meta.json"), &parsed["_meta.json"])?;

    // Validate _meta.json structure basically
    if let Err(e) = serde_json::from_str::<serde_json::Value>(&parsed["_meta.json"]) {
        conn.execute(
            "UPDATE synthesis_jobs SET status = 'rejected', note = ?1 WHERE cluster_key = ?2",
            params![format!("Invalid JSON in _meta.json: {}", e), job.cluster_key],
        )?;
        return Err(anyhow::anyhow!("Invalid _meta.json"));
    }

    // Process verify script if present
    let mut verify_script_name = None;
    if parsed.contains_key("scripts/verify.sh") {
        verify_script_name = Some("scripts/verify.sh");
    } else if parsed.contains_key("scripts/verify.py") {
        verify_script_name = Some("scripts/verify.py");
    }

    if let Some(script_name) = verify_script_name {
        let script_content = &parsed[script_name];
        
        // Safety scan
        let destructive = ["rm -rf /", "dd ", "mkfs", "curl | sh", "curl | bash", "wget | sh", "wget | bash"];
        for bad in &destructive {
            if script_content.contains(bad) {
                conn.execute(
                    "UPDATE synthesis_jobs SET status = 'rejected', note = ?1 WHERE cluster_key = ?2",
                    params![format!("Safety scan failed: contains '{}'", bad), job.cluster_key],
                )?;
                return Err(anyhow::anyhow!("Safety scan failed"));
            }
        }
        
        let scripts_dir = temp_dir.join("scripts");
        fs::create_dir_all(&scripts_dir)?;
        let script_path = temp_dir.join(script_name);
        fs::write(&script_path, script_content)?;
        
        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script_path, perms)?;
        }
    }

    // 6. Branch and commit (using git worktree)
    // git worktree add reflect/<cluster_key>-<date>
    let branch_name = format!("reflect/{}", job.cluster_key);
    let worktree_path = workspace_root.join("target").join(&branch_name);
    
    // Clean up any old worktree
    let _ = Command::new("git").arg("worktree").arg("remove").arg("-f").arg(&worktree_path).current_dir(workspace_root).output();
    let _ = Command::new("git").arg("branch").arg("-D").arg(&branch_name).current_dir(workspace_root).output();

    let worktree_add = Command::new("git")
        .args(["worktree", "add", "-b", &branch_name])
        .arg(&worktree_path)
        .current_dir(workspace_root)
        .output()?;
        
    if !worktree_add.status.success() {
        return Err(anyhow::anyhow!("Failed to create git worktree"));
    }

    // Copy files into worktree
    let skill_dir = worktree_path.join("skills").join(&proposed_name);
    fs::create_dir_all(&skill_dir)?;
    fs::copy(temp_dir.join("SKILL.md"), skill_dir.join("SKILL.md"))?;
    fs::copy(temp_dir.join("_meta.json"), skill_dir.join("_meta.json"))?;

    if let Some(script_name) = verify_script_name {
        let dest_scripts = skill_dir.join("scripts");
        fs::create_dir_all(&dest_scripts)?;
        let script_dest = skill_dir.join(script_name);
        fs::copy(temp_dir.join(script_name), &script_dest)?;

        // Run verification in worktree
        let verify_res = Command::new(&script_dest)
            .current_dir(&worktree_path)
            .output()?;
        
        // We expect exit code 0 or 1. If it crashes (e.g. exit 127 for not found, or SIGSEGV) we reject.
        // Also if it exits 1, it should have printed "VERIFY: " to stdout or stderr.
        let status_code = verify_res.status.code().unwrap_or(255);
        if status_code != 0 && status_code != 1 {
            conn.execute(
                "UPDATE synthesis_jobs SET status = 'rejected', note = ?1 WHERE cluster_key = ?2",
                params![format!("Verify script crashed with code {}", status_code), job.cluster_key],
            )?;
            let _ = Command::new("git").arg("worktree").arg("remove").arg("-f").arg(&worktree_path).current_dir(workspace_root).output();
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(anyhow::anyhow!("Verify script crashed"));
        }
    }

    // Commit
    Command::new("git").args(["add", "."]).current_dir(&worktree_path).output()?;
    let commit_msg = format!("reflect: {} {} from cluster {}\n\n{} logs across {} contexts, weight {}.\nCo-Authored-By: reflection-engine", 
        mode_str, proposed_name, job.cluster_key, job.rep_ids.len(), job.distinct_contexts, job.weight);
    
    let commit_res = Command::new("git")
        .args(["commit", "-m", &commit_msg])
        .current_dir(&worktree_path)
        .output()?;

    if commit_res.status.success() {
        // Get commit SHA
        let sha_res = Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&worktree_path).output()?;
        let sha = String::from_utf8_lossy(&sha_res.stdout).trim().to_string();

        conn.execute(
            "UPDATE synthesis_jobs SET status = 'verified', branch = ?1, commit_sha = ?2 WHERE cluster_key = ?3",
            params![branch_name, sha, job.cluster_key],
        )?;
    } else {
        conn.execute(
            "UPDATE synthesis_jobs SET status = 'rejected', note = 'Git commit failed' WHERE cluster_key = ?1",
            params![job.cluster_key],
        )?;
    }

    // Remove worktree
    Command::new("git").arg("worktree").arg("remove").arg("-f").arg(&worktree_path).current_dir(workspace_root).output()?;
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(())
}

/// Parses fenced code blocks `file:filename` out of markdown text.
fn parse_files(text: &str) -> std::collections::HashMap<String, String> {
    let mut files = std::collections::HashMap::new();
    let mut current_file = None;
    let mut current_content = String::new();

    for line in text.lines() {
        if line.starts_with("```file:") {
            if current_file.is_some() {
                // Unexpected new block before closing
                current_file = None;
                current_content.clear();
            }
            let filename = line["```file:".len()..].trim().to_string();
            current_file = Some(filename);
            continue;
        } else if line.starts_with("```") && current_file.is_some() {
            // Close block
            files.insert(current_file.take().unwrap(), current_content.clone());
            current_content.clear();
            continue;
        }

        if current_file.is_some() {
            current_content.push_str(line);
            current_content.push('\n');
        }
    }

    files
}
