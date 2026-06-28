use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Modifier, Style},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Terminal,
};
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use std::io::Stdout;
use crate::db::{MemoryVault, ExperienceLog};

pub struct App {
    vault: MemoryVault,
    logs: Vec<ExperienceLog>,
    selected_index: usize,
    should_quit: bool,
}

impl App {
    pub fn new(db_path: &str) -> anyhow::Result<Self> {
        let vault = MemoryVault::new(db_path)?;
        let logs = vault.get_all_logs().unwrap_or_default();
        Ok(Self {
            vault,
            logs,
            selected_index: 0,
            should_quit: false,
        })
    }

    pub fn run(&mut self, terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> anyhow::Result<()> {
        while !self.should_quit {
            terminal.draw(|f| self.ui(f))?;
            self.handle_events()?;
        }
        Ok(())
    }

    fn handle_events(&mut self) -> anyhow::Result<()> {
        if event::poll(std::time::Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => self.should_quit = true,
                        KeyCode::Down | KeyCode::Char('j') => {
                            if !self.logs.is_empty() && self.selected_index < self.logs.len() - 1 {
                                self.selected_index += 1;
                            }
                        }
                        KeyCode::Up | KeyCode::Char('k') => {
                            if self.selected_index > 0 {
                                self.selected_index -= 1;
                            }
                        }
                        KeyCode::Char('r') => {
                            // Refresh
                            if let Ok(logs) = self.vault.get_all_logs() {
                                self.logs = logs;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        Ok(())
    }

    fn ui(&self, f: &mut ratatui::Frame) {
        let chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(30), Constraint::Percentage(70)].as_ref())
            .split(f.area());

        let items: Vec<ListItem> = self.logs.iter().enumerate().map(|(i, log)| {
            let style = if i == self.selected_index {
                Style::default().add_modifier(Modifier::REVERSED)
            } else {
                Style::default()
            };
            // Format item title with ID
            let title = format!("[{}] {}", log.id, log.task_context);
            ListItem::new(title).style(style)
        }).collect();

        let list = List::new(items)
            .block(Block::default().borders(Borders::ALL).title("Experience Vault (Press 'r' to refresh, 'q' to quit)"));
        f.render_widget(list, chunks[0]);

        if let Some(log) = self.logs.get(self.selected_index) {
            let content = format!(
                "LOG ID: {}\nTIMESTAMP: {}\n\n-- TASK CONTEXT --\n{}\n\n-- ERROR TRACE --\n{}\n\n-- RESOLUTION --\n{}",
                log.id,
                log.timestamp,
                log.task_context,
                log.error_trace.as_deref().unwrap_or("No error recorded"),
                log.resolution.as_deref().unwrap_or("No resolution recorded"),
            );
            let detail = Paragraph::new(content)
                .wrap(Wrap { trim: true })
                .block(Block::default().borders(Borders::ALL).title("Memory Details"));
            f.render_widget(detail, chunks[1]);
        } else {
            let detail = Paragraph::new("No logs found. Waiting for AI agent experiences...")
                .block(Block::default().borders(Borders::ALL).title("Memory Details"));
            f.render_widget(detail, chunks[1]);
        }
    }
}
