# Game Building Mechanics Analysis

Comprehensive analysis of building systems from six influential games. Each section covers mechanics, performance strategies, design philosophy, and lessons learned.

## Fortnite

### Overview

Fortnite's building system prioritizes speed and combat integration over realism. Players construct walls, floors, ramps, and roofs in a 1x1 grid with instant placement. The system became the game's defining feature, creating a unique competitive meta where building skill often matters more than aim.

### Mechanics

**Grid System:** Strict 1x1 meter grid with four piece types (wall, floor, ramp, roof). Each piece occupies exactly one cell. No free placement, no angle options beyond 90° rotations.

**Edit System:** Fortnite's innovation is the edit system. Players can modify placed pieces by selecting cells in a 3x3 grid overlay. This creates windows, doors, half-walls, and complex shapes from basic pieces. Editing is fast (under 0.5 seconds for experienced players) and temporary edits can be confirmed or cancelled.

**Material Tiers:** Three materials (wood, brick, metal) with different health and build time. Wood builds fastest but has lowest health. Metal is strongest but builds slowest. This creates tactical decisions during combat.

**No Stability:** Pieces can float. A single floor can extend infinitely without support. This enables "sky basing" and other unrealistic but fun strategies.

### Performance Strategy

**Tick Rate:** Fortnite runs building at 30Hz on servers, not 60Hz. This halves network overhead while remaining responsive enough for the game's combat pace. Source: Hone.gg analysis of Fortnite networking.

**LOD System:** Distant buildings use "bubble wrap" low-detail meshes. Competitive players actually prefer this since it reduces visual noise while maintaining collision accuracy.

**Network Optimization:** Building uses delta compression aggressively. Only changed cells transmit, not full structure state. Edits transmit as bitmasks (9 bits for 3x3 grid state).

### Design Philosophy

Epic's approach treats building as an extension of combat, not a separate system. Building and shooting use the same input flow. The skill ceiling is extremely high but basic building is accessible within minutes.

**Key Quote:** "Building isn't about making structures, it's about controlling space in combat."

### Lessons

What works: Speed, simplicity, tight combat integration, edit system as skill expression. What doesn't apply elsewhere: Floating pieces work for competitive shooters but break immersion in survival games. Material tier combat balance is specific to Fortnite's TTK values.

---

## Rust

### Overview

Rust's building system balances base construction for defense against raids, resource management through upkeep costs, and server performance through decay mechanics. It's the most sophisticated survival building implementation, refined over a decade of development.

### Mechanics

**Building Plan and Hammer:** Two-tool system. Building Plan places initial twig pieces, Hammer upgrades materials and rotates. This forces vulnerable construction phases (twig walls are destructible in seconds).

**Material Progression:** Five tiers: twig → wood → stone → metal → armored. Each tier requires different resources and provides different raid resistance. Upgrading is piece-by-piece, creating granular cost decisions.

**Stability System:** Heuristic-based. Foundations provide 100% stability. Each piece away from foundation loses approximately 10% stability, capped at 6 pieces horizontally from support. Vertical builds can extend further with pillar support.

**Tool Cupboard (TC):** Defines building privilege zones. Players must authorize on TC to build within its radius (default ~30 meters). TC also stores upkeep resources. This creates raid targets (destroy TC, building privilege ends) and ownership mechanics.

**Decay System:** Unprotected pieces decay over hours (twig in 1 hour, armored in 12 hours). TC protection requires deposited resources proportional to enclosed pieces. This forces active maintenance and automatically cleans abandoned bases.

### Performance Strategy

**Building IDs:** Each connected structure gets a unique ID. Queries for "all pieces in this base" use ID lookup, not spatial queries. This is O(1) for structure operations.

**Entity Limits:** Rust servers target 200k entities before mandatory wipe. Decay is the primary mechanism keeping count manageable. Without decay, servers reach entity limits within days on popular servers.

**Occlusion Culling:** All geometry participates in occlusion, including player-built structures. A large base becomes an occluder, hiding entities behind it. This turns potential performance problems (large builds) into performance aids.

**Building ID Quote (Devblog 185):** "We group all connected pieces under a single building ID. This lets us query, update, and network entire structures efficiently."

### Design Philosophy

Rust treats building as a resource sink and soft progression gate. Early game uses cheap wood, late game armored requires significant grinding. Upkeep prevents infinite accumulation. Raiding provides a "reset" mechanism, redistributing wealth.

**Key Insight:** Decay serves gameplay AND performance. It's not a compromise but a synergy.

### Lessons

What works: TC system for permissions, decay for server health, building IDs for performance, material progression for soft gating. What to adapt: Decay rates need tuning per game. Rust's rates assume daily play; casual games need longer timers or different mechanisms.

---

## Valheim

### Overview

Valheim's building system emphasizes aesthetics and exploration over defense. The stability system creates believable structures without complex physics simulation. Performance challenges emerge at scale since the game wasn't originally designed for massive builds.

### Mechanics

**Stability from Ground:** Pieces connected to ground (via foundations, stone, or natural terrain) have 100% stability. Each piece away from ground loses stability. At 0%, pieces break. This creates the "magic force from ground" described by developers.

**Color Coding:** Stability displays as piece color: blue (high), green (good), yellow (warning), orange (critical), red (will break). This immediate feedback guides building without numerical displays.

**Material Properties:** Wood has lower stability transmission than stone. Stone floors can support more than wood. This encourages material mixing and realistic-looking structures.

**No Grid:** Valheim uses snap points, not grids. Pieces snap to valid attachment points on other pieces. This enables more organic shapes than strict grids while maintaining structural logic.

**Weather and Damage:** Rain damages exposed wood. Fire spreads. These create maintenance requirements without the explicit upkeep resource systems of Rust.

### Performance Challenges

**Instance Limits:** Large builds (10k+ pieces) cause significant FPS drops even on powerful hardware. Valheim wasn't optimized for Minecraft-scale construction.

**Draw Calls:** Each unique piece type increases draw calls. Valheim's varied piece set (dozens of piece types) creates overhead that simpler games avoid.

**Terrain Interaction:** The terrain modification system (flattening, raising) creates permanent mesh changes that accumulate over time, consuming memory.

**Community Feedback:** "Stuck at 40 FPS with a large build on an RTX 3080" is a common complaint. The solution is usually reducing piece count or using mods that merge meshes.

### Design Philosophy

Iron Gate prioritized building feeling over building efficiency. The stability system is explicitly unrealistic but intuitive. Players understand "connect to ground" without engineering knowledge.

**Developer Quote:** "It doesn't work like real materials – it's more like pressure in a plumbing system, a magic force from the ground."

### Lessons

What works: Ground-based stability is intuitive, color-coded feedback is accessible (note: uses blue, not green, for colorblind accessibility), snap points enable organic builds. What to avoid: Scaling to large builds requires explicit optimization that Valheim initially lacked.

---

## Minecraft

### Overview

Minecraft's voxel building is the simplest analyzed here. No physics, no stability, infinite placement. Its influence is immense, but most of its patterns don't translate directly to polygon-based 3D building.

### Mechanics

**Voxel Grid:** Strict 1x1x1 meter blocks. Every position either contains a block or is empty. No rotation (most blocks), no partial placement.

**No Physics for Placement:** Blocks can float. Sand and gravel have gravity, but structural blocks don't. This enables impossible architecture and removes construction barriers.

**Infinite World:** Chunk-based world streaming. New terrain generates procedurally as players explore. Building is unlimited in all directions.

**Redstone:** Logic system using redstone dust, torches, repeaters, and comparators. Enables computational machines, automation, and complex contraptions. Runs on a 10Hz tick (2 game ticks per redstone tick).

### Performance Strategy

**Chunk System:** 16x16x256 (Java) or 16x16x384 (Bedrock) block columns. Only chunks near players are loaded. Unloaded chunks don't simulate.

**Block Updates:** Changes propagate to adjacent blocks only. A block change in an empty area affects 6 neighbors maximum. Complex redstone can chain updates but locality limits cascade.

**Greedy Meshing:** Rendering combines adjacent same-type blocks into larger quads, dramatically reducing vertex count for large flat surfaces.

### Design Philosophy

Minecraft proves that removing complexity can create depth. Without stability concerns, players focus purely on aesthetics and creativity. The redstone system provides engineering challenge for those who want it.

### Lessons

What applies: Chunk systems for infinite worlds, update locality for performance. What doesn't translate: Voxel assumptions (uniform block size, no rotation) rarely fit polygon-based games. Lack of physics is a specific aesthetic choice that doesn't suit survival games.

---

## No Man's Sky

### Overview

No Man's Sky added base building post-launch and iterated extensively. The system combines snap points with free placement, supporting both structured bases and artistic freedom. Cross-platform persistence added complexity.

### Mechanics

**Hybrid Placement:** Structure pieces (walls, floors) use snap points. Decorative pieces can be placed freely within bounds. This satisfies organized builders and creative decorators.

**Base Computer:** Defines base boundaries and ownership. Similar to Rust's TC but with explicit visual boundaries. Base upload enables sharing discoveries.

**Power System:** Electrical networks with generators, batteries, and wires. Limited power budgets force decisions. Solar panels add day/night dynamics.

**Terrain Editing:** Players can modify terrain within bases. Extensive modification can cause issues with terrain regeneration on reload (a historical bug source).

### Performance Strategy

**Base Complexity Limits:** Hard caps on piece count per base (approximately 3000 uploadable pieces, more locally). This prevents server database bloat and ensures bases can load on all platforms.

**Cross-Platform Considerations:** Building must work identically on PS4, PS5, Xbox, PC, and Switch. Lowest common denominator influences limits.

**Upload vs Local:** Bases can be larger locally than when uploaded. Uploaded bases are simplified for other players' visits.

### Design Philosophy

Hello Games treats bases as creative expression and exploration markers rather than survival necessities. The system evolved based on community feedback, adding requested features iteratively.

### Lessons

What works: Hybrid snap/free placement, explicit complexity limits, base computer ownership model. Challenges: Cross-platform parity requires conservative limits. Terrain modification persistence remains technically difficult.

---

## Satisfactory

### Overview

Satisfactory combines building with factory automation. The construction system must support conveyor networks, fluid pipes, and power lines alongside traditional buildings. This creates unique hybrid requirements.

### Mechanics

**Foundation Grid:** Structures snap to a 4m or 8m foundation grid. Buildings align to foundations, creating organized factories.

**Free Conveyors:** Conveyors and pipes ignore the grid. They connect machine inputs/outputs with flexible routing. Players can build "spaghetti" (chaotic conveyors) or "organized" (aligned to grid) factories.

**Soft Clearance:** Unlike strict collision games, Satisfactory allows some clipping. Conveyor belts can pass through walls. This reduces frustration when routing complex networks.

**Blueprint System:** Players can save and load factory sections. Blueprints include all connected pieces and auto-place sequentially.

### Performance Strategy

**Tick Splitting:** Factory logic doesn't run every frame. Production cycles calculate periodically, with visual interpolation between. A smelter might update actual inventory every second but animate continuously.

**Conveyor Optimization:** Items on belts are simulated as a queue, not individual physics objects. A belt holds N items at specific positions, updated mathematically rather than physically.

**Building Instancing:** Repeated buildings (foundations, walls) use GPU instancing heavily. A factory floor of 1000 foundations renders nearly as efficiently as 1.

### Design Philosophy

Coffee Stain Studios recognizes that factory builders have two player types: engineers who want grid-perfect organization and creatives who want freedom. The hybrid system serves both.

**Key Insight:** The grid exists for those who want it. Free placement exists for those who don't. Neither is mandatory.

### Lessons

What works: Hybrid grid/free placement, soft clearance for complex routing, factory-specific optimizations (belt queues, tick splitting). What's specific: Satisfactory's approach optimizes for horizontal sprawl, not vertical buildings. Survival games with tall structures need different strategies.

---

## Decision Matrices

### Physics Mode Selection

When choosing between arcade, heuristic, and realistic physics:

**Choose Arcade when** building is secondary to action gameplay, players need instant gratification, or competitive balance matters more than realism. Fortnite exemplifies this approach. Players accept floating pieces because the alternative (waiting for stability calculations) would break combat flow.

**Choose Heuristic when** building is a core loop activity, believability matters but frustration must be minimized, or performance budgets are tight. Rust and Valheim demonstrate that "good enough" physics satisfies most players while remaining computationally cheap.

**Choose Realistic when** engineering challenge is the primary appeal and your audience accepts failure as part of the experience. Medieval Engineers attempted this and struggled because most players found fighting physics more frustrating than fun. This approach requires extensive tutorialization and forgiving failure states.

### Multiplayer Authority Model

When choosing between server-authoritative, client-authoritative, and hybrid models:

**Server-authoritative** is mandatory for competitive games and any context where cheating matters. Rust uses this despite the latency cost because raid defense requires trustworthy state. The trade-off is visible placement delay (typically 50-150ms round-trip).

**Client-authoritative** works only in trusted environments like cooperative games with friends. The responsiveness benefit (instant placement) comes with vulnerability to cheating. Single-player games can be fully client-side since there's no security concern.

**Hybrid prediction** offers the best of both for most games. Client predicts placement, server validates asynchronously, and rollback corrects errors. This requires reconciliation logic and careful handling of rapid sequential placements.

### Grid vs Free Placement

When choosing between strict grids, snap points, and free placement:

**Strict grids** work best when uniformity aids gameplay (Fortnite's combat building benefits from predictable sizes) or when simplicity reduces implementation complexity.

**Snap points** work best for organic aesthetics where players want shaped structures rather than cubic ones. Valheim's Viking longhouses feel handcrafted because snap points allow slight variations.

**Free placement** works best for decorative elements and games prioritizing creativity over structure. No Man's Sky uses this for decorations while keeping structures on snaps.

**Hybrid systems** like Satisfactory's serve games with multiple use cases. Structure pieces grid, routing elements free. This adds implementation complexity but satisfies diverse player preferences.

### Decay and Persistence

When choosing whether and how to implement decay:

**Implement decay when** servers run persistently and abandoned structures would accumulate, when resource sinks serve gameplay balance, or when active maintenance creates meaningful play loops.

**Skip decay when** the game is single-player or session-based, when building is purely creative without survival pressure, or when your audience expects permanent construction.

**Decay rate tuning** depends on expected play frequency. Rust assumes daily login and uses hours-long timers. A casual game might use weekly timers. The key is matching expectations since decay that destroys builds before players return feels punishing rather than fair.

---

## Anti-Patterns

### Medieval Engineers' Realism Trap

Medieval Engineers implemented detailed physics simulation for building stability. The result: players spent more time fighting physics than building. Pieces collapsed unexpectedly. Learning to build required engineering knowledge. The game struggled commercially.

**Lesson:** Realism should serve fun, not replace it. If players need a physics degree to enjoy building, you've gone too far.

### Ark's Performance Spiral

Ark: Survival Evolved allowed massive bases without adequate decay or limits. Official servers became unplayable as abandoned structures accumulated. The solution (aggressive decay timers) frustrated players who expected persistence.

**Lesson:** Plan for server lifespan from the start. Retroactive cleanup mechanisms feel punishing even when technically necessary.

### Early Fortnite's Edit Vulnerability

Initial edit implementation allowed editing enemy structures. This broke defensive play entirely since any wall could be instantly modified by opponents. Epic iterated to the current owner-only editing.

**Lesson:** Building systems interact with all other systems. Consider exploits, griefing, and unintended interactions during design rather than patching later.

---

## Architectural Recommendations by Genre

### Battle Royale / Competitive Shooters

Prioritize speed over realism. Use arcade physics (no stability). Implement strict grids for predictable combat spaces. Network building at lower tick rates (30Hz is sufficient). Design for destruction (buildings are temporary combat tools, not permanent structures).

### Survival Games

Use heuristic physics with clear feedback. Implement decay proportional to expected session length. Create ownership systems (TC or equivalent). Balance building costs as soft progression gates. Design for raiding or environmental threats to give building defensive purpose.

### Creative Sandboxes

Minimize or eliminate physics restrictions. Provide both grid and free placement options. Implement blueprint/copy systems for complex builds. Focus performance optimization on piece count since creative players build big. Skip decay unless multiplayer servers need cleanup.

### Factory/Automation Games

Support hybrid placement (grid structures, free routing). Optimize for horizontal scale over vertical height. Implement instancing aggressively for repeated elements. Consider tick-splitting for simulation-heavy elements. Provide blueprint systems for factory duplication.
