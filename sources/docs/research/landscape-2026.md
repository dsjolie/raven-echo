# Personal AI Assistant Landscape: February 2026

Research on the current state of personal AI agents, frameworks, and architectural patterns.

## The Market Right Now

Personal AI assistants have moved from experimental curiosity to genuine daily-driver tools. The landscape divides into three categories:

### 1. Full Personal Assistants (Closest to Raven's Goal)

**OpenClaw** (142k+ GitHub stars) is the breakout project. Created by Peter Steinberger, it runs locally, connects to 12+ messaging platforms, has an extensible skills system, and can act autonomously on your machine. Built on TypeScript/Node.js with the Pi minimal agent core. Already covered in detail in [openclaw.md](./openclaw.md) and [pi.md](./pi.md).

**Jan.ai** is a privacy-focused assistant that runs completely locally, with optional cloud model integration and MCP support. Less autonomous than OpenClaw but cleaner privacy story.

**PyGPT** is an open-source desktop assistant supporting multiple model providers (GPT-5, Claude, Gemini, Grok, DeepSeek, Mistral, Ollama). Offers chat, vision, agents, audio, research, and computer use modes. Python-based, which aligns with Raven's stack.

**Leon AI** has been in development since 2017, transitioning from classifier-based to a fully autonomous ReAct agent using local LLMs and Atomic Tools.

**Goose** is a local development agent with SKILL.md-based capabilities, auto-discovered at startup. Strong at building projects, writing/executing code, debugging, and orchestrating workflows.

### 2. Coding-Focused Agents

**Open Interpreter** bridges LLM reasoning with local code execution (Python, JavaScript, Shell). Supports local models via Ollama/LM Studio. Focus is on the exec() loop rather than multi-agent orchestration.

**Aider** is a CLI coding assistant working directly with local Git repositories.

These are narrower than Raven's vision but demonstrate proven patterns for the code execution skill.

### 3. Agent Frameworks (For Building Assistants)

| Framework | Architecture | Best For | Notes |
|-----------|-------------|----------|-------|
| **PydanticAI** | Type-safe with FSM | Production-grade Python | Built by the Pydantic team; native MCP support |
| **LangGraph** | Graph-based orchestration | Complex stateful workflows | Most mature ecosystem |
| **CrewAI** (~40k stars) | Role-based crews + flows | Multi-agent collaboration | Good for rapid prototyping |
| **AutoGen** (Microsoft) | Async message-passing | Research, multi-agent | Strong on agent communication |
| **SmolAgents** (HuggingFace) | ~10k lines of code | Lightweight prototyping | Minimal overhead |
| **Agno** | Modular, swappable | Production with observability | Good DevOps story |

**Note:** The original recommendation here was PydanticAI. After further evaluation, the Claude Agent SDK may be a better fit -- it provides a complete agent runtime rather than just a framework, and Raven's single-provider setup (Claude) doesn't need model-agnostic abstractions. See [claude-for-raven.md](./claude-for-raven.md). The language choice (Python vs TypeScript) is also revisited in [typescript-vs-python.md](./typescript-vs-python.md).

## Key Design Patterns

### The ReAct Loop

The dominant pattern across all successful agents: **Reason** about the task, **Act** (call a tool), **Observe** the result, repeat. This is the core loop Raven needs. Everything else is built around it.

### Memory: Start Simple

Consensus in the field: "The gap between demo and production is usually memory management." This is precisely why overengineering memory early is a trap.

**What OpenClaw/Pi actually do:**
- **Append-only JSONL transcripts** -- every interaction is a log entry
- **Mutable sessions.json** for key-value metadata
- **Auto-compaction** when context window fills (summarize, flush important state to files)
- **Pre-compaction memory flush** -- before summarizing, persist anything important to workspace files
- **No vector database, no embeddings, no knowledge graph**

This is enough. The file system *is* the memory. Important things get written to files. The agent can read them when needed. Context compaction handles the window.

**For reference**, the academic taxonomy distinguishes episodic (past events), semantic (facts/concepts), and procedural (skills/how-to) memory. Dedicated systems like Mem0 (41k stars) provide sophisticated implementations with vector search and graph memory. But these add complexity that isn't justified until the simple approach demonstrably fails.

**Raven's starting approach should be:**
1. Append-only session transcripts (JSONL)
2. Workspace files for persistent state (the agent writes what it wants to remember)
3. Auto-compaction when context fills
4. Graduate to more sophisticated memory only when the file-based approach breaks down

### Context Engineering

A new discipline is emerging: treating the context window as a first-class system with its own architecture. The guiding principle: *find the minimal effective context required for the next step.*

**Key problems:**
- **Context Rot** -- Performance degrades as the window fills, even within technical limits. Effective window is often <256k tokens regardless of advertised limits.
- **Lost in the Middle** -- Accuracy drops for content placed in the middle of long contexts.
- **Context Pollution** -- Too much irrelevant or redundant information.

**Strategies that work:**
1. **Layered context** -- Meta (identity) -> Operational (task/tools) -> Domain (knowledge) -> Historical (condensed memory) -> Environmental (live data)
2. **Compaction** -- Summarize older events when approaching limits (OpenClaw does this automatically)
3. **Prefix caching** -- Keep system prompts stable at the start for KV-cache reuse
4. **Selective injection** -- Load context on-demand rather than maintaining everything
5. **Planning-based reduction** -- Plan first, then execute sub-tasks with only relevant context per step

**Decision framework by scale:**
- 10-50k tokens: compression + KV-cache optimisation
- 50-100k: offload to external memory + smart retrieval
- 100k+: multi-agent isolation (each sub-agent gets only its relevant context)

### Model Context Protocol (MCP)

MCP has become the de facto standard for connecting agents to external tools -- described as "USB-C for AI." Introduced by Anthropic in November 2024, donated to the Linux Foundation in December 2025.

- JSON-RPC 2.0 transport (reuses Language Server Protocol patterns)
- Servers expose tools; Clients (LLMs/apps) send standardised requests
- OpenAI adopted it in March 2025 and deprecated the Assistants API
- SDKs for Python, TypeScript, C#, Java
- 2026 roadmap: Agent-to-Agent communication

**For Raven:** OpenClaw's approach is instructive -- they deliberately avoid native MCP, using **MCPorter** as a CLI bridge instead. The agent calls `mcporter` via Bash to access any MCP server without embedding MCP protocol code. This keeps the core minimal and treats MCP tools like any other CLI tool. See [mcporter.md](./mcporter.md) for details.

### LLM Provider Abstraction

**LiteLLM** is the standard multi-provider abstraction (100+ APIs, fallback/retry, cost tracking). However, for a personal assistant using a single Claude subscription, this is unnecessary complexity. The Claude Agent SDK handles the Claude connection directly. Multi-provider routing can be added later if needed.

### Skill/Plugin Architectures

Two dominant patterns:

1. **MCP-based tools** -- Standard protocol for structured data and tool access. Agents discover and invoke tools via the protocol. Universal support.

2. **SKILL.md files** -- An open standard where skills are folders with a SKILL.md containing metadata and instructions. LLMs load capabilities on-demand, keeping base context lean. Used by Goose and Claude's own skill system. Complementary to MCP (skills = workflows/capabilities, MCP = data/tool access).

**Security note:** Research has shown 26% of the 31,000 analysed agent skills in OpenClaw's ecosystem contained at least one vulnerability. Skill sandboxing and auditing are not optional.

## Privacy and Local-First in 2026

This is an inflection point where local-first AI is moving from niche to mainstream:

- **EU AI Act** fully applicable August 2026, fines up to 7% of global revenue
- **EU Data Act** effective September 2025
- **Local inference runtimes** (Ollama, LM Studio, vLLM, llama.cpp) can run capable models locally
- **Smaller specialised models** via distillation and quantisation enable strong performance on modest hardware
- Mid-range GPU setup ($1,200-1,800 with RTX 4060) hits the sweet spot for personal use

Raven's privacy-first design philosophy is well-timed. The opt-in approach to external API calls aligns with both regulatory trends and user expectations.

## Common Capability Tiers

What people actually build into personal AI assistants, ordered by prevalence:

**Tier 1 (Core):** Conversational chat, web search, file operations, code execution, document Q&A/RAG

**Tier 2 (Productivity):** Calendar integration, email management, task management, note-taking, browser automation

**Tier 3 (Automation):** Multi-step workflows, notifications/messaging, data analysis, image/media generation, smart home/IoT

**Tier 4 (Emerging):** Self-improving skills, multi-agent delegation, continuous learning from experience

Raven's TODO.md plans (file ops, web research, code analysis) align with Tier 1 -- the right starting point.

## Technology Alignment for Raven

Based on this research and Raven's stated principles:

*Revised 2026-02-05 to favour simplicity over comprehensiveness.*

| Component | Approach | Rationale |
|-----------|---------|-----------|
| **Core agent loop** | Claude Agent SDK | Full runtime provided; don't rebuild what exists |
| **LLM** | Claude via API key | Single provider, keep it simple. Route later if needed |
| **Tool integration** | MCPorter (CLI bridge to MCP ecosystem) | Pi pattern: agent calls CLI via Bash, no protocol code in core |
| **Skills** | SKILL.md pattern | On-demand loading, lean context |
| **Memory** | JSONL transcripts + workspace files | OpenClaw/Pi pattern: the file system is the memory |
| **Context** | Auto-compaction (Agent SDK handles this) | Don't build what the SDK provides |
| **Language** | TypeScript (recommended, see evaluation) | Every reference project is TS; async model is safer; type safety |

## Key Insight

The most successful personal AI assistants start minimal and compose. Pi's philosophy -- four core tools (Read, Write, Edit, Bash) + self-extension -- beats the approach of trying to be comprehensive from day one.

For Raven specifically:
- **Don't build an agent loop** -- the Claude Agent SDK provides one
- **Don't build a memory system** -- use files and auto-compaction
- **Don't abstract the LLM provider** -- you're using Claude
- **Don't embed MCP client code** -- use MCPorter via CLI
- **Do** build the identity, the skills, the interfaces, the things that make Raven *Raven*

## Related Research

- [TypeScript vs Python evaluation](./typescript-vs-python.md)
- [MCPorter research](./mcporter.md)
- [Claude for Raven: simplest path](./claude-for-raven.md)
- [OpenClaw research](./openclaw.md)
- [Pi research](./pi.md)

## Sources

### Projects
- [OpenClaw](https://github.com/openclaw/openclaw) - Open-source personal AI assistant
- [Jan.ai](https://jan.ai/) - Privacy-focused local AI
- [PyGPT](https://pygpt.net/) - Multi-provider desktop assistant
- [Leon AI](https://github.com/leon-ai/leon) - Open-source personal assistant
- [Goose](https://github.com/block/goose) - Local development agent
- [Open Interpreter](https://github.com/openinterpreter/open-interpreter) - Code execution agent

### Frameworks
- [PydanticAI](https://ai.pydantic.dev/) - Type-safe Python agent framework
- [LangGraph](https://github.com/langchain-ai/langgraph) - Graph-based agent orchestration
- [CrewAI](https://github.com/crewAIInc/crewAI) - Multi-agent collaboration
- [SmolAgents](https://github.com/huggingface/smolagents) - Minimal agent framework

### Infrastructure
- [LiteLLM](https://github.com/BerriAI/litellm) - LLM provider abstraction
- [Mem0](https://github.com/mem0ai/mem0) - Memory layer for AI agents
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol

### Research and Analysis
- [Agentic AI Design Patterns 2026](https://medium.com/@dewasheesh.rana/agentic-ai-design-patterns-2026-ed-e3a5125162c5)
- [Agent Memory Paper List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)
- [Maxim: Context Window Management](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/)
- [JetBrains: Efficient Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Cisco: OpenClaw Security Analysis](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare)

---

*Research conducted: 2026-02-05*
