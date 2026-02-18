---
title: "Codebases: Relational or Graph?"
date: 2026-02-13
time: "08:29"
source_url: "https://gemini.google.com/share/a5dbddbde78e"
notes: "graph, agentic coding"
---

## User

You said
Are codebases relational?

---

## Assistant

The question of whether codebases are "relational" depends on whether you are looking at the
data they manage
or the
structure of the code itself
.
Strictly speaking, codebases are not relational in the same way a database is, but they rely heavily on relationships to function.
1. The Structure of Code (Non-Relational)
Most modern codebases are organized
hierarchically
or
graph-based
, rather than in flat, relational tables.
- File Systems:Code is stored in a tree-like directory structure (folders within folders).
- Abstract Syntax Trees (AST):When a compiler reads your code, it turns it into a tree structure to understand the logic.
- Object-Oriented Programming (OOP):OOP uses inheritance and composition.While "relationships" exist (like aCar"is-a"Vehicle), these are pointers in memory, not relational joins.
2. The Logic of Code (Relational-Adjacent)
While the storage isn't relational, the
architecture
often is. Engineers use several concepts that mirror relational algebra:
| Concept | Relational Database Equivalent | Codebase Equivalent |
| --- | --- | --- |
| Identification | Primary Key | Unique IDs, Memory Addresses, or UUIDs |
| Connection | Foreign Key | References, Pointers, or Dependency Injection |
| Mapping | Joins | Object-Relational Mapping (ORM) or Data Streams |
The Role of ORMs
Because code handles objects and databases handle tables, we use
Object-Relational Mapping (ORM)
tools (like Hibernate or Prisma).
These act as a bridge, translating the "relational" world of data into the "hierarchical" world of code.
3. Dependency Graphs
If you look at how different parts of a codebase interact, it looks like a
Directed Acyclic Graph (DAG)
.
- Module AimportsModule B.
- Function XcallsFunction Y.
This is a set of relationships, but it lacks the strict mathematical constraints (like Normalization) found in relational databases. You can't "query" a standard codebase using SQL to find all functions with a certain property without specialized static analysis tools.
Summary
A codebase is
not
a relational system by default; it is a
graph of dependencies
. However, it becomes "relational" the moment it starts modeling real-world data and enforcing links between different entities.
Would you like me to explain how a specific tool, like a graph database or an ORM, bridges these two different worlds?

---

## User

You said
Aren‘t specific parts of codebases dependant on ither parts? so changes at one place would require adjustments in other so the code won‘t break?

---

## Assistant

Yes, you are describing
Coupling
, and it is one of the most critical concepts in software engineering. When parts of a codebase are dependent on each other, they form a
Dependency Graph
.
While this involves "relationships," it differs from a relational database because these connections are often rigid and fragile rather than fluid and queryable.
1. How Dependencies Create "Fragility"
In a codebase, dependencies usually follow a
Directional Flow
. If Module A depends on Module B, any change to the "Interface" (the way they talk to each other) in Module B will break Module A.
- Syntactic Dependencies:If you change a function name from`calculateTotal()`to`getTotal()`, every file calling that function will fail to compile.
- Semantic Dependencies:If you change a function to return aStringinstead of anInteger, the logic in other parts of the code might "break" even if the code still runs (e.g., trying to add a number to a word).
2. Types of Dependencies
Engineers categorize these relationships to understand how much a change in one place will "ripple" through the system:
| Dependency Type | Description | Risk Level |
| --- | --- | --- |
| Tight Coupling | Classes or modules are highly dependent on each other's internal logic. | High(Changes cause "Shotgun Surgery") |
| Loose Coupling | Modules interact through a stable, simple interface (like an API). | Low(Internal changes don't break others) |
| Circular Dependency | Module A depends on B, and B depends on A. | Extreme(Can cause infinite loops or build failures) |
3. The "Relational" Problem: Shotgun Surgery
When a codebase is "too relational" in the wrong way, we encounter a "code smell" called
Shotgun Surgery
. This happens when a single change in one data structure requires you to make dozens of tiny edits across different files.
To prevent this, developers use
Abstractions
:
1. Interfaces/Protocols:Instead of depending on a specific "Class," you depend on a "Contract."
2. Encapsulation:You hide the internal data so other parts of the code can't "bind" to it too tightly.
4. Why this isn't "Relational" in the DB sense
In a relational database, you can add a new column to a table without necessarily breaking every query. In a codebase, adding a mandatory parameter to a function is a
Breaking Change
.
Code is
compiled
and
linked
, meaning the relationships are often hard-coded into the binary structure of the application.
Summary
You are correct—codebases are massive webs of dependencies. The goal of a good senior developer isn't to eliminate these relationships, but to manage them so that a change in "Part A" doesn't bring down the entire "Part B" through
Decoupling
.
Would you like me to show you an example of how "Dependency Injection" can help break these rigid links so your code is easier to change?

---

## User

You said
Also arent different module interacting with each other to form the entire system?

---

## Assistant

You're exactly right. A codebase isn't just a collection of files; it is a
dynamic system
where the "sum is greater than the parts." When these modules interact, they create the functional behavior of the software.
This interaction is typically managed through
Interfaces
and
APIs
, which act as the "handshakes" between different modules.
1. The Modular Architecture
Think of a codebase like a LEGO set.
Each module (a "brick") has a specific shape and purpose.
The "nubs" on the bricks are the interfaces that allow them to click together.
- Encapsulation:Each module hides its internal complexity. You don't need to know how the "Engine" module works to call the`start()`function from the "Dashboard" module.
- Integration:The system is formed when these isolated modules exchange data or signals.
2. How Modules "Talk"
There are three main ways modules interact to form a system:
| Interaction Method | How it Works | Example |
| --- | --- | --- |
| Direct Calls | One module explicitly calls a function in another. | `PaymentModule.process(order)` |
| Event-Driven | A module "broadcasts" that something happened; others listen. | `OrderPlaced`event triggers the`EmailModule`. |
| Shared State | Modules read and write to the same data store. | Two modules updating a`UserSession`object. |
3. The "System" vs. The "Code"
The "System" is the
runtime behavior
—what happens when the code is actually executing. The "Codebase" is just the blueprint.
When modules interact, they form a
Call Stack
. If Module A calls B, and B calls C, they are momentarily linked in memory. If any part of that chain fails or returns an unexpected value, the "system" fails, even if the individual modules are technically "correct" on their own.
4. The Danger: "Spaghetti Code"
When modules interact too much or in disorganized ways, you get
Spaghetti Code
. This is where every module is connected to every other module.
In a "Relational" sense, this is like having a database where every table has a foreign key to every other table. It becomes impossible to move or change anything because the "web" is too tangled. This is why software architects spend so much time on
Orchestration
—deciding exactly how and when modules are allowed to speak to each other.
Summary
The "system" is the result of these interactions. A codebase is relational in its
logic
(how things connect) and hierarchical in its
storage
(how files are saved), but it is a
graph
in its
execution
(how modules interact).
Would you like to see how a "Microservices" architecture takes this idea and splits these modules into entirely separate programs?

---

## User

You said
Is that an issue for ai coding?

---

## Assistant

This is actually the
single biggest challenge
for AI coding today. While an AI can easily write a 50-line function, it struggles with the "relational" nature of a 50,000-line codebase.
When you ask an AI to change one thing, it often fails to see the "ripple effect" across the modules you mentioned. Here is why those interconnected relationships are so difficult for AI:
1. The "Context Window" Problem
An AI has a limited "memory" (called a context window) during a single chat.
- The Issue:If your codebase has 500 files, the AI cannot "see" all of them at once.
- The Result:It might suggest a change in`UserModule.js`that perfectly solves your problem but accidentally breaks`BillingModule.js`because it didn't know those two were "related" or coupled.
2. Tracking Indirect Dependencies
AI is great at
Direct Dependencies
(if File A imports File B). It is much worse at
Indirect or Behavioral Dependencies
.
- Example:You have a database schema change.
- The AI's Mistake:It updates the SQL table and the Backend model, but forgets to update the TypeScript interface in the Frontend and the validation logic in the API Gateway.
- Because these files are stored in different folders and don't "import" each other directly, the AI doesn't always realize they are logically linked.
3. The "Hallucination" of Interfaces
Because AI predicts the
next likely word
, it often "hallucinates" that a module has a certain capability just because it would make sense for it to exist.
AI Logic:
"I'm in the
`Auth`
module, so there
should
be a
`validateToken()`
function in the
`Security`
module."
If that function doesn't exist or is named
`check_token()`
, the code will crash. The AI treats the codebase as a sea of text rather than a rigid, relational graph.
4. How Modern AI Tools Fix This
To solve the issues you identified, AI coding tools (like Cursor, Windsurf, or GitHub Copilot) use a technique called
RAG (Retrieval-Augmented Generation)
:
1. Indexing:They pre-scan your entire codebase and build a "Map" (a vector index) of how every file relates to others.
2. Retrieval:When you ask a question, the tool "searches" the map to find all relevant modules, even if they aren't the one you're currently looking at.
3. LSP Integration:They use Language Server Protocols (the same tech that underlines your code in red when you make a typo) to feed the AI real-time "relational" data about types and function signatures.
The Verdict
The "interconnectedness" you pointed out is exactly why we don't have "Auto-Pilot" coding yet. AI is a great
Junior Developer
(writing the parts), but it's a poor
Software Architect
(managing the whole system).
It can write the "brick," but it often forgets how that brick is supposed to click into the rest of the LEGO castle.
Would you like to know which specific AI prompts help the model "see" these hidden dependencies more clearly?

---

## User

You said
Does it makes sense to create a graph database of a codebase for an agent to move in?

---

## Assistant

It makes
perfect
sense. In fact, this is exactly what the most advanced "AI Coding Agents" (like those used by GitHub, Google, and specialized startups) are doing behind the scenes.
By representing a codebase as a
Knowledge Graph
, you turn a flat pile of text files into a navigable, relational map.
This solves the "Context Window" problem by letting the AI "walk" the dependencies.
1. Why a Graph is Better than a "Search"
Most AI tools use
Vector Search
(finding similar text). But in code, "similar" isn't always "relevant."
- Vector Search:Finds other files that use the word "User."
- Graph Database:Finds thespecificfile that defines the`User`object, the five files thatimportit, and the database schema thatconstrainsit.
2. What the "Nodes" and "Edges" Look Like
If you were to build this for an agent, your graph (often called a
Code Property Graph
) would look like this:
| Entity (Nodes) | Relationships (Edges) |
| --- | --- |
| Files | `CONTAINS`(Classes),`IMPORTS`(Other Files) |
| Functions | `CALLS`(Other Functions),`DEFINES`(Variables) |
| Classes | `INHERITS_FROM`(Parent Class),`IMPLEMENTS`(Interface) |
| Commits | `MODIFIED`(Files),`AUTHORED_BY`(Developer) |
3. How the Agent "Moves"
Instead of the agent guessing which file to open next, it can run "Graph Queries" (like Cypher or SPARQL).
1. Step 1:The agent is told to "Change the login logic."
2. Step 2:It queries the graph:"Find all functions that call`auth.validate()`."
3. Step 3:The graph returns a list of 4 files.
4. Step 4:The agent "hops" to those specific nodes.
This prevents the agent from getting "lost" in a 10,000-file repository. It only sees the
Relevant Subgraph
.
4. The Challenges of This Approach
While it sounds perfect, there are two major hurdles:
- Syncing Reality:Every time a human (or the agent) writes a line of code, the graph is technically "out of date." You need a "Language Server" running constantly to update the graph in real-time.
- The "Global" vs. "Local" Trade-off:Graphs are great forstructuralrelationships (who calls whom), but they are less effective at capturinglogic(how a specific`if/else`block works). The agent still needs to read the actual text once it "arrives" at a node.
The Verdict
Creating a graph database is the "Holy Grail" for AI agents. It transforms the codebase from a
library of books
into a
GPS-mapped city
. Without a graph, the AI is a tourist with a phrasebook; with a graph, the AI is a local courier who knows every shortcut.
Would you like me to outline a simple Python script using a library like
`NetworkX`
or
`Tree-sitter`
to start building a basic graph of your own code?

---

## User

You said
How would you habdle the global vs local trade off?
populate each node with vectors or direct pointers to the actual codebase?

---

## Assistant

To handle the
Global vs. Local
tradeoff effectively, you don't actually have to choose one over the other. The most sophisticated AI agents use a
Hybrid Architecture
.
Think of the
Graph
as the "Map" (Global) and the
Vectors/Text
as the "Street View" (Local). To make an agent navigate this successfully, you should use a technique called
GraphRAG
.
1. The Hybrid Approach: "Linked Embedding"
Instead of just storing a pointer (like a file path), you should
populate each node with both
. Here is the ideal data structure for a node in your graph:
- Metadata (The Pointer):File path, line numbers, and character offsets.
- The "Gist" (The Vector):A high-dimensional embedding of the code block'sintent(e.g., "This function calculates tax").
- The Content (The Raw Code):The actual text of the function or class.
2. Solving the "Global" Problem
When the agent starts a task, it doesn't know where to look.
1. Global Search:The agent performs a vector search across the entire graph to find the "Entry Point" (e.g., "Login Logic").
2. Graph Expansion:Once it finds the "Login" node, it looks at theEdgesto see what that node is connected to (e.g.,`DatabaseModule`,`UserSession`).
3. Contextual Pruning:The agent only "loads" the code from those specific connected nodes into its memory. This keeps the "Context Window" clean.
3. Solving the "Local" Problem
Once the agent is "standing" at a node (like a specific function), it needs to understand the fine-grained logic.
- Abstract Syntax Tree (AST) Pointers:You don't just point to a file; you point to a specific "Branch" of the code's tree.
- Direct Pointers:By keeping a direct pointer to the codebase, the agent can "Verify" its knowledge. If the graph says a function exists, the agent can instantly pull the latest version of that file to ensure the graph isn't "stale."
4. The "Summarization" Trick
A major challenge is that a "Global" view can get overwhelming. To solve this, you can create
Hierarchy Nodes
:
- Level 1 (The File):A summary of what the file does.
- Level 2 (The Class):A summary of the class's methods.
- Level 3 (The Function):The actual raw code.
The agent starts at Level 1. If it thinks the file is relevant, it "drills down" to Level 3. This saves massive amounts of "tokens" (money/processing power) because the agent only reads the complex code when it's 90% sure it's in the right place.
Implementation Strategy
If you were building this today, I would recommend:
1. Use`tree-sitter`:To parse the code into its structural components (functions, classes).
2. Use`Neo4j`or`FalkorDB`:To store the relationships.
3. Use a Vector Index (like`Chroma`or`Pinecone`):To store the embeddingsinsidethe graph nodes.
Would you like me to show you a simple conceptual schema for how a
`Function`
node would look in a graph database like Neo4j?

---

## User

You said
Think deeply about the problem, then think about the best solution even if we haven‘t discussed it yet

---

## Assistant

This is a complex systems engineering problem. To solve it, we need to move beyond simple "search" or "databases" and look at how human experts navigate code.
The "Best Solution" is not just a database; it is a
Hierarchical, Multi-Modal Code Knowledge Graph
.
This architecture solves the Global vs. Local trade-off by treating the codebase like a geographic map: it has a "Satellite View" (Global/Vector) for orientation and a "Street View" (Local/Symbolic) for execution.
Here is the blueprint for the
Semantic-Symbolic Twin
.
1. The Architecture: The "Tri-State" Node
The biggest mistake in current AI coding tools is storing
raw code
in the vector database. Raw code is noisy. Instead, every node in your graph (representing a Function, Class, or File) should hold
three distinct distinct types of data
:
| Data Layer | Purpose | Content (The Payload) |
| --- | --- | --- |
| 1. The Semantic Layer | "Find it" | A vector embedding of agenerated summary(e.g., "Validates user JWT tokens").Do not embed the code itself. |
| 2. The Symbolic Layer | "Connect it" | TheAST Signature. Parameters, return types, and explicit edges to other nodes (`CALLS`,`IMPORTS`,`OVERRIDES`). |
| 3. The Source Layer | "Read it" | A direct file pointer (path + line numbers) to the raw text on disk. |
Why this is the best solution:
- Vectorsfind theintent("I need login logic").
- Symbolic Edgesfind thetruth("This function calls the database").
- Pointerskeep the database light and ensure the agent always reads thelatestversion of the file, solving the "stale data" problem.
2. The Navigation Strategy: "Anchor & Walk"
An agent shouldn't just "query" the database; it should "traverse" it. This mimics how a Senior Engineer debugs.
Phase A: The Global Anchor (Vector Search)
The agent asks, "Where is the payment validation logic?"
- Action:The system scans theSemantic Layer(summaries).
- Result:It lands on`PaymentValidator.ts`.
- Status:The agent has found theneighborhood, but not the specific house.
Phase B: The Local Walk (Graph Traversal)
Now the agent switches to the
Symbolic Layer
. It doesn't need vectors anymore; it needs hard dependencies.
- Query:"Show me everything`PaymentValidator`depends on."
- Action:The graph expands 1 hop outward. It finds`UserSchema`,`StripeAPI`, and`CurrencyConverter`.
- Pruning:The agent ignores`CurrencyConverter`because it's irrelevant to "validation," but keeps`UserSchema`.
Phase C: The "Context Slice"
This is the critical step. instead of feeding the AI the
entire files
found in Phase B, the system generates a
Minimal Executable Slice
.
- It grabs the code for`PaymentValidator`.
- It grabsonly the interface definitionsof`UserSchema`(not the implementation).
- It packages this into a concise prompt.
3. The "Secret Sauce": Dynamic LSP Injection
Static graphs have a fatal flaw: they don't know if the code compiles. The "Best Solution" integrates a
Language Server Protocol (LSP)
(the tool that powers VS Code's IntelliSense) directly into the graph query engine.
The Workflow:
1. Agent:"I want to rename`getUser()`to`fetchUser()`."
2. Graph DB:Identifying 50 files that call`getUser()`.
3. LSP Check (The Guardrail):The system asks the LSP, "If I rename this symbol, which of these 50 files willactuallybreak?"
4. Result:The LSP confirms only 42 files are affected (the other 8 used a different`getUser`function).
5. Action:The agent only edits the 42 relevant files.
This prevents the "Hallucination of Relationships" where the AI assumes two functions are linked just because they share a name.
4. Summary of the "Best Solution"
To build the ultimate environment for an AI coding agent, you don't choose between Global Vectors or Local Pointers. You build a system that cycles through them:
1. Ingest:Parse code into a Graph (Nodes = Code Units, Edges = Dependencies).
2. Enrich:Generate summaries for each node and embed them (Vector Layer).
3. Query:UseVectorsto land on the right node (Global).UseGraph Edgesto gather the surrounding context (Local).UseLSPto validate the specific logical links (Ground Truth).
  - UseVectorsto land on the right node (Global).
  - UseGraph Edgesto gather the surrounding context (Local).
  - UseLSPto validate the specific logical links (Ground Truth).
Would you like me to generate a pseudo-code example of how to define this "Tri-State Node" structure in Python?

---

## User

You said
Think about how coding tools like antigravity and the new codex app work and their context and token limitations.
does it make sense to enable them to connect to such a graph db through mcp for building?

---

## Assistant

Yes, it makes
strategic sense
, and frankly, it is the inevitable evolution of these tools.
Tools like
Google Antigravity
(which focuses on "agentic" workflows and autonomous planning) and
Windsurf/Cursor
(which rely on RAG) are currently hitting a ceiling:
The Context Window Efficiency Trap.
Connecting them to a Graph Database via
MCP (Model Context Protocol)
is the exact architectural fix they need.
1. The Problem: "Context Stuffing" is Inefficient
Current tools (like Windsurf's "Cascade" or Cursor's
`@codebase`
) work by stuffing as much relevant text as possible into the token window (e.g., 200k–1M tokens).
- Wasted Tokens:If you need to knowwho calls`auth.login()`, the tool might retrieve 50 full files just to check the import statements. That could cost 100k tokens.
- Loss of IQ:As context windows fill up, models suffer from "Lost in the Middle" syndrome—they forget instructions buried in the center of the prompt.
2. The Solution: MCP as the "Brain Stem"
By using the
Model Context Protocol (MCP)
to connect an Agent (Antigravity) to a Graph DB (Neo4j/FalkorDB), you change the paradigm from
"Read everything"
to
"Ask, don't read."
Here is why this specific combination (Antigravity + MCP + Graph) is powerful:
A. Offloading Structure to the Graph
Instead of pasting 50 files into the context to understand the architecture, the Agent sends an MCP tool call:
- Agent:"Get me the dependency tree for`PaymentService`."
- MCP Server (Graph):Runs a Cypher query and returns a lightweight JSON object (e.g., 50 lines of text) representing the structure.
- Token Savings:You just saved ~99% of your tokens compared to reading the raw files. You kept thestructurebut discarded theimplementation detailsuntil you actually needed them.
B. The "Antigravity" Context (Planning)
Antigravity is unique because it separates "Planning" from "Coding."
- The Plan:The agent can use the Graph to build a high-level plan ("I need to touch these 4 files and update this 1 interface"). The Graph gives it theConfidencethat it hasn't missed a hidden dependency.
- The Execution:Only when the agent starts writing code does it pull the actual file content (Vectors/Local) into the context.
3. How to Architect This (The "MCP Bridge")
If you were building this, you wouldn't just "dump" the graph into the chat. You would build a specific
MCP Server
with these capabilities:
| MCP Tool Name | Function | Why it beats standard RAG |
| --- | --- | --- |
| `get_impact_radius` | "If I change Function X, return a list of all functions that call it." | Standard RAG guesses this based on text similarity; Graphs know it as a fact. |
| `find_circular_deps` | "Check if adding this import creates a loop." | LLMs cannot compute this in their head; a Graph query does it in 5ms. |
| `verify_interface_compliance` | "Does Class A actually implement all methods of Interface B?" | Saves the agent from hallucinating methods that don't exist. |
4. The Risk: Latency vs. Accuracy
The only downside is
Latency
.
- Vector Searchis instant (milliseconds).
- Graph Queriesvia MCP require a "Tool Roundtrip" (The model pauses, sends a request, waits for the MCP server, gets a response, then continues).
- Mitigation:You would only use the Graph forHigh-Stakes Planning(e.g., "Analyze the repository structure") and use standard Vector Search forLow-Stakes Retrieval(e.g., "Find similar code").
Summary
Connecting Antigravity to a Graph DB via MCP allows you to treat the context window as a
Workspace
(active files only) rather than a
Library
(storage).
It turns the agent from a "Reader" (who has to read 100 books to find one fact) into a "Librarian" (who consults the index card catalog—the Graph—before walking to the shelf).

---

## User

You said
Please design the ideal graph db design for sgentic coding that takes the initial problem, the coding agent behaviour and solves this specific issue for agentic coding.

---

## Assistant

This is the blueprint for the
"Semantic-Symbolic Code Twin."
This design is not just a standard Code Property Graph (CPG). It is specifically engineered for
Agentic Coding
to solve the "Context Window" and "Hallucination" problems we discussed. It bridges the gap between the rigid truth of a compiler and the fuzzy reasoning of an LLM.
1. The Core Philosophy: "The Tri-State Node"
Every node in this graph is a "Hybrid Entity." It holds three distinct types of data so the agent can switch modes (Search vs. Navigate vs. Read) without context switching.
- The Anchor (Symbolic):The undeniable truth (Names, Types, Signatures).
- The Map (Semantic):The "fuzzy" meaning (Vector Embeddings ofsummaries, not code).
- The Pointer (Source):The link to reality (File Path + Line Numbers).
2. The Ideal Schema Design
A. The Nodes (Entities)
We avoid storing AST-level noise (like
`IfStatement`
or
`Loop`
). We focus on
Architectural Units
that an agent cares about.
| Node Label | Represents | Critical Properties |
| --- | --- | --- |
| `File` | A physical file on disk. | `path`,`language`,`last_modified_hash` |
| `Module` | A logical grouping (folder/package). | `name`,`namespace` |
| `Class`/`Interface` | An object definition. | `name`,`is_abstract`,`super_classes` |
| `Function` | A callable unit. | `signature`,`return_type`,`visibility`(public/private) |
| `Variable` | Global or class-level state. | `type`,`is_constant`,`default_value` |
| `ExternalLib` | A "Shadow Node" for 3rd party code. | `package_name`,`version`(Agent can see it but not read it) |
B. The Edges (Relationships)
The relationships are directed and typed. This allows the agent to answer specific questions like
"Who calls this?"
vs.
"Where is this defined?"
- `CONTAINS`:`File -> Class`,`Class -> Function`(The hierarchy).
- `IMPORTS`:`File -> File`(The physical dependency).
- `CALLS`:`Function -> Function`(The execution flow).
- `READS`/`WRITES`:`Function -> Variable`(The state impact).
- `INHERITS`:`Class -> Class`(The polymorphic structure).
- `EXPOSES`:`Module -> Function`(The public API).
3. The "Agent-First" Features (The Secret Sauce)
To make this truly "ideal" for an agent like Antigravity or Windsurf, we add
Computed Properties
that don't exist in standard graphs.
Feature 1: The "Summary Embedding" (Semantic Search)
Instead of embedding the raw code of
`calculateTotal()`
, we use a small LLM to generate a summary:
"Iterates through line items and applies tax rules."
- Why?When the agent searches for "tax logic," it matches theintent, not just variable names.
- Property:`node.embedding = vector(summary)`
Feature 2: The "Stability Score" (Risk Analysis)
We calculate a PageRank-style score for every node based on how many other nodes depend on it.
- High Score (e.g.,`UserID`):"Do not touch this unless absolutely necessary. It breaks everything."
- Low Score (e.g.,`renderFooter`):"Safe to edit."
- Property:`node.stability_index`(0.0 - 1.0)
Feature 3: The "Shadow Graph" (External Context)
When your code imports
`React`
or
`Pandas`
, the agent usually hallucinates what functions are available.
- Solution:We create "Shadow Nodes" for external libraries. We don't index their code, but we index theirPublic Interface(signatures).
- Result:The agent knows`pandas.DataFrame`exists and has a`.head()`method, even if it can't read the Pandas source code.
4. The MCP Interface (How the Agent "Talks")
The agent does not write Cypher/SQL queries. It uses
MCP Tools
that abstract the graph complexity into "Agent Actions."
Tool 1:
`locate_concept(query: str)`
- Logic:Vector search on the`summary`property.
- Agent Prompt:"Find code related to 'JWT Validation'."
- Return:List of`Function`nodes (IDs + Summaries).
Tool 2:
`explore_neighborhood(node_id: str, depth: int)`
- Logic:Traverses`CALLS`and`READS`edges outward.
- Agent Prompt:"I'm changing`validateUser`. What else do I need to know?"
- Return:A JSON tree of immediate dependencies (Callers and Callees).
Tool 3:
`check_impact(node_id: str)`
- Logic:Reverse traversal of`DEPENDS_ON`.
- Agent Prompt:"If I delete this class, what breaks?"
- Return:A list of files and specific line numbers that will fail to compile.
5. The "Live Sync" Challenge (Implementation)
The graph is useless if it's outdated. Here is the
Update Loop
:
1. The Watcher:A file system watcher (like`chokidar`) detects a save event.
2. The Parser:`tree-sitter`parsesonlythe changed file.
3. The Diff:The system identifies which nodes were added/removed.
4. The Patch:New Function:Create node, generate summary (via small LLM), calculate embedding, insert.Modified Function:Update summary? (Only if diff is large), update pointer.Deleted:Remove node + relationships.
  - New Function:Create node, generate summary (via small LLM), calculate embedding, insert.
  - Modified Function:Update summary? (Only if diff is large), update pointer.
  - Deleted:Remove node + relationships.
Summary of the Design
This "Semantic-Symbolic Twin" allows the agent to:
1. Plan globallyusing Vector Search ("Where is the logic?").
2. Navigate locallyusing the Graph ("Who calls this?").
3. Read preciselyusing File Pointers ("Fetch lines 50-85 of`auth.ts`").
This effectively creates an
"Infinite Context Window"
by only loading the exact bytes needed for the task at hand.

---

## User

You said
Csn you check if this setup is ideal for modular building, coding in natural language for users and ideal ‚translation‘ into code and coding principles, quick bug fixes, documentation, security.
think about each deeply and assess seperately

---

## Assistant

This is the ultimate stress test. A system that looks good on a whiteboard often fails when you try to use it for specific workflows like "coding in natural language" or "security auditing."
Below is a deep assessment of the
Semantic-Symbolic Code Twin
architecture against the six pillars you defined.
1. Modular Building
The Goal:
To build software like LEGOs—swapping parts in and out without the whole castle collapsing.
- How the Graph Helps:Boundary Enforcement:The graph explicitly maps`IMPORTS`and`CALLS`. If you try to remove a module, the graph immediately lights up with "red" edges showing every other part of the system that is holding onto it.Decoupling Assistant:You can write a query:"Show me all modules that are Tightly Coupled (have > 5 dependencies) to the User Module."This allows the agent to proactively suggest refactoring before you even start building.
  - Boundary Enforcement:The graph explicitly maps`IMPORTS`and`CALLS`. If you try to remove a module, the graph immediately lights up with "red" edges showing every other part of the system that is holding onto it.
  - Decoupling Assistant:You can write a query:"Show me all modules that are Tightly Coupled (have > 5 dependencies) to the User Module."This allows the agent to proactively suggest refactoring before you even start building.
- The Missing Piece:To beideal, the graph needs"Interface Nodes."It’s not enough to know Module A calls Module B. You need to know if Module A relies on aconcrete implementation(bad) or aninterface(good).Refinement:Add an`IMPLEMENTS`edge. The agent should prioritize connecting modules via these abstract nodes.
  - Refinement:Add an`IMPLEMENTS`edge. The agent should prioritize connecting modules via these abstract nodes.
- Verdict:9/10.It prevents "Spaghetti Code" by making dependencies visible.
2. Coding in Natural Language
The Goal:
A user says
"Make the login button blue,"
and the system knows exactly which CSS file, React component, and config file to touch.
- How the Graph Helps:The Semantic Bridge:This is where theVector Layer(summaries) shines. Users speak in "Intent" ("login button"), not "Implementation" (`auth_btn_v2.tsx`).Disambiguation:If the user says "Fix the date format," the graph knows there are three "Date" functions. It can ask:"Do you mean the`InvoiceDate`in the billing module or the`UserBirthDate`in the profile module?"because it sees they are in different sub-graphs.
  - The Semantic Bridge:This is where theVector Layer(summaries) shines. Users speak in "Intent" ("login button"), not "Implementation" (`auth_btn_v2.tsx`).
  - Disambiguation:If the user says "Fix the date format," the graph knows there are three "Date" functions. It can ask:"Do you mean the`InvoiceDate`in the billing module or the`UserBirthDate`in the profile module?"because it sees they are in different sub-graphs.
- The Risk:Drift.If the code changes but thesummaryisn't updated, the vectors become useless. The "Natural Language" feature breaks if the graph is even 10 minutes out of date.Refinement:The "Watcher" system must re-generate summaries oneveryfile save.
  - Refinement:The "Watcher" system must re-generate summaries oneveryfile save.
- Verdict:8/10.Excellent for findingwhereto code, but relies heavily on the quality of the generated summaries.
3. Translation into Code & Principles
The Goal:
The AI writes code that looks like
your
code, not generic StackOverflow code.
- How the Graph Helps:Style Injection:When the agent retrieves the`User`class to add a feature, the graph also pulls theStyle Guide Node(or linter config) linked to that module.Pattern Matching:The agent can query:"How do other modules handle error logging?"The graph returns 5 examples fromyourcodebase. The AI mimics these patterns, ensuring consistency.
  - Style Injection:When the agent retrieves the`User`class to add a feature, the graph also pulls theStyle Guide Node(or linter config) linked to that module.
  - Pattern Matching:The agent can query:"How do other modules handle error logging?"The graph returns 5 examples fromyourcodebase. The AI mimics these patterns, ensuring consistency.
- The "Context" Win:Because the graph only pulls the relevant interfaces (not the full implementation), you can fitmoreexamples into the context window. This gives the LLM more "training data" from your own repo.
- Verdict:10/10.This is the strongest point. It turns the AI from a "Generalist" into a "Specialist" in your specific tech stack.
4. Quick Bug Fixes
The Goal:
"Production is down. Fix it now."
- How the Graph Helps:Root Cause Analysis:If an error occurs in`Module Z`, the graph allows the agent to traverse the`CALLED_BY`edges backwards to find the origin. It traces the "Blast Radius."Impact Analysis:Before applying a fix, the agent checks:"If I change this variable, what else breaks?"The graph answers instantly.
  - Root Cause Analysis:If an error occurs in`Module Z`, the graph allows the agent to traverse the`CALLED_BY`edges backwards to find the origin. It traces the "Blast Radius."
  - Impact Analysis:Before applying a fix, the agent checks:"If I change this variable, what else breaks?"The graph answers instantly.
- The Limitation:Graphs are static structure; bugs are oftenruntime states(e.g., a variable is`null`when it shouldn't be). The graph can show you the path, but it can't "replay" the error.Refinement:Ideally, you would attachRuntime Logsto the graph nodes. If`Function X`throws an error, the graph node for`Function X`should glow "red" with the stack trace attached.
  - Refinement:Ideally, you would attachRuntime Logsto the graph nodes. If`Function X`throws an error, the graph node for`Function X`should glow "red" with the stack trace attached.
- Verdict:8.5/10.It speeds up theinvestigationmassively, but you still need a human or a debugger to verify thefix.
5. Documentation
The Goal:
Documentation that is never out of date.
- How the Graph Helps:Living Docs:TheSemantic Layer(those generated summaries)isthe documentation. You can literally export the graph nodes to a Markdown file, and you have a full API reference.Onboarding:A new developer (or agent) can ask:"Draw me a high-level map of the payment flow."The graph filters for`Payment`nodes and`CALLS`edges, generating a visual architecture diagram on the fly.
  - Living Docs:TheSemantic Layer(those generated summaries)isthe documentation. You can literally export the graph nodes to a Markdown file, and you have a full API reference.
  - Onboarding:A new developer (or agent) can ask:"Draw me a high-level map of the payment flow."The graph filters for`Payment`nodes and`CALLS`edges, generating a visual architecture diagram on the fly.
- Verdict:10/10.The graphautomatesthe most boring part of coding.
6. Security
The Goal:
Catching vulnerabilities (like SQL Injection) before they merge.
- How the Graph Helps:Taint Analysis:This is the killer feature. If you mark a node as "User Input" (Source) and another node as "Database Query" (Sink), the graph can find if there is a path between them thatdoesn'tgo through a "Sanitization Function."Supply Chain Visibility:The "Shadow Nodes" for external libraries allow you to instantly query:"Which parts of my code use the vulnerable version of`log4j`?"
  - Taint Analysis:This is the killer feature. If you mark a node as "User Input" (Source) and another node as "Database Query" (Sink), the graph can find if there is a path between them thatdoesn'tgo through a "Sanitization Function."
  - Supply Chain Visibility:The "Shadow Nodes" for external libraries allow you to instantly query:"Which parts of my code use the vulnerable version of`log4j`?"
- The Missing Piece:You need a specific edge type:`FLOWS_TO`. Standard dependency edges (`CALLS`) aren't precise enough for security. You need to track data flow, not just control flow.
- Verdict:9/10.It turns security reviews from a manual "hunt" into a database query.
Final Assessment Table
| Feature | Score | Why it works | What makes it "Ideal" (The Fix) |
| --- | --- | --- | --- |
| Modular Building | 9/10 | Enforces boundaries. | AddInterface Nodesto promote loose coupling. |
| Natural Language | 8/10 | Maps intent to code location. | Real-time Re-indexingto prevent "drift." |
| Translation | 10/10 | Provides perfect context. | UseFew-Shot Examplesfrom the graph itself. |
| Bug Fixes | 8.5/10 | Traces dependencies instantly. | AttachRuntime/Error Logsto graph nodes. |
| Documentation | 10/10 | Auto-generates summaries. | Export graph directly toMarkdown/Wikis. |
| Security | 9/10 | Enables Taint Analysis. | Add`FLOWS_TO`edges for data tracking. |
Conclusion
This setup is
nearly ideal
. It excels at
Translation
,
Documentation
, and
Architecture (Modularity)
.
Its only weaknesses are in
Runtime State
(Bugs) and
Data Flow Granularity
(Security). If you add "Data Flow Edges" and "Interface Nodes" to the schema I proposed earlier, you will have a system that outperforms 99% of human software teams.
Would you like me to map out the specific "Security Schema" (Nodes & Edges) needed to enable that Taint Analysis feature?

---

## User

You said
Are the types of relationships also mapped in this?

---

## Assistant

Yes, they are. In a high-functioning
Agentic Code Graph
, the
type
of relationship (the Edge) is arguably more important than the node itself.
A generic "connects to" edge is useless for an agent. To solve the issues of modularity, security, and bug fixes, the graph must distinguish between
Control Flow
(who calls whom),
Data Flow
(where information travels), and
Logical Structure
(who owns whom).
1. The Relationship Taxonomy
To make the system "ideal," we map these relationships into four distinct categories:
| Relationship Category | Edge Types (Examples) | Solving the Problem |
| --- | --- | --- |
| Structural(Ownership) | `CONTAINS`,`DEFINES`,`DECLARES` | Modularity:Understands the "Russian Doll" nesting of files and classes. |
| Functional(Execution) | `CALLS`,`OVERRIDES`,`ASYNC_AWAIT` | Bug Fixes:Traces the "Chain of Blame" when a function crashes. |
| Data Flow(Information) | `READS`,`WRITES`,`PASSES_TO` | Security:Tracks how "Tainted" user input reaches a database (Taint Analysis). |
| Abstract(Contracts) | `IMPLEMENTS`,`INHERITS`,`MOCKS` | Translation:Ensures the AI uses the correct Interface rather than a concrete class. |
2. Why "Data Flow" is the Game Changer
Most code graphs only map "Function A calls Function B." But an agent needs to know:
"Does the
`userID`
variable from the API request actually reach the
`DeleteUser`
query?"
Mapping the
`PASSES_TO`
relationship allows for
Impact Prediction
:
- Scenario:You want to change a variable from a`String`to a`Number`.
- The Graph:It doesn't just show you the functions; it shows you the "Value Pipeline." It highlights every node where that specific piece of data is stored or transformed.
- Result:No more "Type Errors" at runtime.
3. "Interface" vs. "Implementation" Edges
This is critical for
Modular Building
. In the graph, we map two different ways a module can "depend" on another:
1. Hard Dependency (`DEPENDS_ON`):Module A uses a specific version of Module B. If B changes, A breaks.
2. Soft Dependency (`SATISFIES`):Module A depends on anInterface. As long as Module B still satisfies that interface, B can be completely rewritten without A ever knowing.
By mapping these differently, the agent can tell you:
"You can safely rewrite this logic because it's behind a 'Satisfies' edge, so the rest of the system is insulated."
4. Semantic Relationships (The "Why")
Finally, we add a layer of
Intent Relationships
. These are often inferred by the LLM during the indexing phase:
- `VALIDATES`: Connects a`ValidationFunction`to a`DataModel`. (Useful forSecurity)
- `DEPRECATED_BY`: Connects an old function to a new one. (Useful forMaintenance)
- `HANDLES_ERROR_FROM`: Connects a`Try/Catch`block to the function it monitors. (Useful forBug Fixes)
Summary: The "Ideal" Mapping
By mapping these specific relationship types, you transform the agent from a
Text Editor
into a
Systems Engineer
.
- Security:It sees the`PASSES_TO`flow.
- Modularity:It respects the`SATISFIES`boundaries.
- Translation:It understands the`INHERITS`logic.
Would you like me to show you a Cypher query (the language used for graphs) that would find a security vulnerability using these specific edge types?

---

## User

You said
Please describe the final system in detail. do not list any specific examples without stating that these are only examples to paint the picture not to steer the model into a direction.
please also define exactly how an agent should interact with the system via mcp.

---

## Assistant

This is the detailed architectural specification for the
Semantic-Symbolic Code Twin
.
This system acts as the central nervous system for an AI coding agent. It is designed to overcome the limitations of context windows and hallucination by converting a codebase into a queryable, relational, and semantic knowledge graph.
Note:
Any specific technologies, variable names, or tool definitions mentioned below are strictly illustrative examples to demonstrate functionality. They should not constrain the implementation choices of the final model.
I. System Architecture: The "Tri-State" Design
The core of the system is the
Tri-State Node
. Unlike standard databases that store only text or only vectors, every entity in this system (File, Function, Class, Variable) is composed of three synchronized data layers.
1. The Symbolic Layer (The Structure)
- Purpose:To provide ground truth and enforce strict logical boundaries.
- Data Source:Derived from Abstract Syntax Tree (AST) parsing.
- Content:Precise definitions of names, types, signatures, and visibility modifiers.
- Role:SolvesModularityandSecurityby mapping rigid dependencies and control flow.
2. The Semantic Layer (The Intent)
- Purpose:To enable natural language understanding and fuzzy retrieval.
- Data Source:Generated by a small, specialized LLM during ingestion.
- Content:A high-dimensional vector embedding of anatural language summaryof the code (not the code itself).
- Role:SolvesNatural Language CodingandDocumentationby mapping user intent ("Validate the user") to code location ("`AuthValidator`class").
3. The Source Layer (The Reality)
- Purpose:To provide the raw material for modification and verify current state.
- Data Source:The file system.
- Content:A direct pointer (file path, start line, end line, byte offset) to the latest version of the code on disk.
- Role:SolvesTranslationandBug Fixesby ensuring the agent reads the exact bytes currently in the buffer, preventing "stale data" hallucinations.
II. The Graph Schema (Nodes & Edges)
The schema must be rigid enough to support compilation logic but flexible enough to capture semantic meaning.
A. Node Taxonomy
Nodes represent the nouns of the codebase.
- Structural Nodes:Represent physical or logical containers (e.g., Directories, Files, Modules, Namespaces).
- Definition Nodes:Represent code constructs (e.g., Classes, Interfaces, Traits, Structs).
- Executable Nodes:Represent logic units (e.g., Functions, Methods, Lambdas).
- State Nodes:Represent data storage (e.g., Variables, Constants, Database Schemas, API Endpoints).
- Shadow Nodes:Represent external dependencies (libraries/frameworks). These contain only Interface signatures (Symbolic Layer) to minimize noise, omitting the implementation.
B. Edge Taxonomy
Edges represent the verbs (relationships) and must be typed to enable advanced reasoning.
- Control Flow Edges:Define execution paths (e.g.,`CALLS`,`INVOKES`,`TRIGGERS`).
- Data Flow Edges:Define the movement of information (e.g.,`READS`,`WRITES`,`RETURNS`,`PASSES_TO`).Crucial for Taint Analysis.
- Hierarchical Edges:Define ownership and containment (e.g.,`CONTAINS`,`DECLARES`,`EXPOSES`).
- Abstract Edges:Define polymorphic relationships (e.g.,`IMPLEMENTS`,`INHERITS`,`OVERRIDES`,`SATISFIES`).Crucial for Modularity.
- Semantic Edges:Define inferred relationships (e.g.,`RELATED_TO`,`DEPRECATES`,`TESTS`).
III. The Agent-System Interface (via MCP)
The Model Context Protocol (MCP) serves as the API gateway. The Agent does not directly query the database (e.g., via SQL/Cypher). Instead, the system exposes
High-Level Capabilities
as MCP Tools.
This abstraction layer prevents the Agent from needing to understand the underlying graph query language.
The Interaction Protocol
The interaction follows a
Plan-Query-Retrieve
loop:
1. Capability: Global Semantic DiscoveryAgent Intent:"Find code relevant to concept X."MCP Tool Definition:A tool that accepts a natural language string.System Action:Performs a vector similarity search against theSemantic Layer(summaries).Output:A list of Node IDs, their Names, and their Confidence Scores.
  - Agent Intent:"Find code relevant to concept X."
  - MCP Tool Definition:A tool that accepts a natural language string.
  - System Action:Performs a vector similarity search against theSemantic Layer(summaries).
  - Output:A list of Node IDs, their Names, and their Confidence Scores.
2. Capability: Local Structural NavigationAgent Intent:"I am at Node A. What interacts with it?"MCP Tool Definition:A tool that accepts a Node ID, a Relationship Type filter (optional), and a Depth limit.System Action:Traverses theSymbolic Layer(Edges) starting from the anchor node.Output:A subgraph (JSON structure) showing the immediate neighborhood (Callers, Callees, Data Dependencies).
  - Agent Intent:"I am at Node A. What interacts with it?"
  - MCP Tool Definition:A tool that accepts a Node ID, a Relationship Type filter (optional), and a Depth limit.
  - System Action:Traverses theSymbolic Layer(Edges) starting from the anchor node.
  - Output:A subgraph (JSON structure) showing the immediate neighborhood (Callers, Callees, Data Dependencies).
3. Capability: Impact Analysis (The "Pre-Flight Check")Agent Intent:"If I modify Node A, what else might break?"MCP Tool Definition:A tool that accepts a Node ID and a modification type (e.g., "Rename", "Change Signature").System Action:Performs a recursive reverse traversal of`DEPENDS_ON`or`CALLS`edges.Output:A list of "At-Risk" nodes (Files/Lines) that require verification.
  - Agent Intent:"If I modify Node A, what else might break?"
  - MCP Tool Definition:A tool that accepts a Node ID and a modification type (e.g., "Rename", "Change Signature").
  - System Action:Performs a recursive reverse traversal of`DEPENDS_ON`or`CALLS`edges.
  - Output:A list of "At-Risk" nodes (Files/Lines) that require verification.
4. Capability: Source Retrieval (The "Read")Agent Intent:"Read the actual code for Node A."MCP Tool Definition:A tool that accepts a Node ID.System Action:Resolves theSource Layerpointer and reads the file from disk (lines X to Y).Output:The raw text of the specific code block.
  - Agent Intent:"Read the actual code for Node A."
  - MCP Tool Definition:A tool that accepts a Node ID.
  - System Action:Resolves theSource Layerpointer and reads the file from disk (lines X to Y).
  - Output:The raw text of the specific code block.
IV. The Synchronization Engine (Maintenance)
For the system to remain "Ideal," the graph must reflect the codebase in real-time. This requires an Event-Driven Architecture.
1. The Watcher:A background process listens for file system events (Create, Update, Delete).
2. Differential Parsing:When a file changes, the system re-parsesonlythat file into a transient AST.
3. Graph Patching:Identify:Match existing nodes to the new AST.Update:Update Symbolic properties (e.g., changed arguments).Re-Embed:If the logic changed significantly, trigger the LLM to generate a new summary and vector embedding.Re-Link:Re-calculate edges (e.g., if a function call was added).
  - Identify:Match existing nodes to the new AST.
  - Update:Update Symbolic properties (e.g., changed arguments).
  - Re-Embed:If the logic changed significantly, trigger the LLM to generate a new summary and vector embedding.
  - Re-Link:Re-calculate edges (e.g., if a function call was added).
V. Operational Summary
This system acts as a
Translation Layer
:
- It translatesUser Intent(Natural Language) intoGraph Nodes(via Vectors).
- It translatesCode Logic(AST) intoGraph Edges(via Parsers).
- It translatesAgent Questions(MCP) intoGraph Queries(via Logic).
This ensures the agent is never "guessing" the structure of the code; it is navigating a verified map.

---

## User

You said
Now also design the schema to ‚translate‘ codebases into this system and instructions on how to build new system that inherently use this system the very first moment

---

## Assistant

This is the technical specification for the
Graph-Native Development Protocol (GNDP)
.
It consists of two parts:
1. The Ingestion Schema:How to "hydrate" an existing legacy codebase into the Semantic-Symbolic Twin.
2. The Construction Protocol:How to build new software where the Graph is the primary source of truth from the first line of code.
Part I: The Translation Schema (Legacy to Graph)
To translate a standard codebase (Files & Folders) into the Tri-State Graph, the Agent must execute a specific
Extraction, Transformation, and Linking (ETL)
pipeline.
1. The Extraction Rules (AST Mapping)
The Agent uses a parser (e.g., Tree-sitter) to walk the raw code. It applies the following
Transformation Logic
to convert AST nodes into Graph Entities.
A. Structural Mapping (The Container)
- IF`Directory`→CREATE`Module`Node`id`:`rel_path/to/dir``name`:`dir_name`
  - `id`:`rel_path/to/dir`
  - `name`:`dir_name`
- IF`SourceFile`→CREATE`File`Node`id`:`rel_path/to/file.ext``language`:`ext``hash`:`sha256(content)`(For drift detection)
  - `id`:`rel_path/to/file.ext`
  - `language`:`ext`
  - `hash`:`sha256(content)`(For drift detection)
B. Symbolic Mapping (The Logic)
- IF`ClassDeclaration`→CREATE`Class`Node`properties`:`{ visibility: "public/private", is_abstract: boolean }`
  - `properties`:`{ visibility: "public/private", is_abstract: boolean }`
- IF`FunctionDeclaration`→CREATE`Function`Node`properties`:`{ parameters: ["a: int", "b: string"], return_type: "void" }`EDGE:`File -[CONTAINS]-> Function`EDGE:`Function -[DEFINED_AT {start_line, end_line}]-> File`(The Source Pointer)
  - `properties`:`{ parameters: ["a: int", "b: string"], return_type: "void" }`
  - EDGE:`File -[CONTAINS]-> Function`
  - EDGE:`Function -[DEFINED_AT {start_line, end_line}]-> File`(The Source Pointer)
C. Dependency Mapping (The Wiring)
- IF`ImportStatement`(e.g.,`import { X } from './Y'`)ACTION:Resolve path`'./Y'`to`File Node Y`.EDGE:`File A -[IMPORTS]-> File Node Y`
  - ACTION:Resolve path`'./Y'`to`File Node Y`.
  - EDGE:`File A -[IMPORTS]-> File Node Y`
- IF`CallExpression`(e.g.,`x.calculate()`)ACTION:Perform "Symbol Resolution" (Scope Check).EDGE:`Function A -[CALLS]-> Function B`
  - ACTION:Perform "Symbol Resolution" (Scope Check).
  - EDGE:`Function A -[CALLS]-> Function B`
2. The Enrichment Rules (Semantic Injection)
Once the skeleton is built, the Agent must apply the "Flesh" (Vectors).
Process:
For every
`Function`
and
`Class`
node created above:
1. Extract:The raw code body + docstrings.
2. Synthesize:Pass to a small LLM with the prompt:"Summarize the intent, inputs, and side-effects of this code in one sentence."
3. Embed:Convert that summary into a Vector.
4. Inject:Update the Graph Node:JSON```code-container
{
  "semantic_summary": "Validates user JWT and throws 403 on expiry.",
  "embedding": [0.12, -0.98, ...],
  "tags": ["auth", "security", "middleware"]
}

```
Part II: The Graph-Native Construction Protocol
This is the instruction set for building a
new
system. In this paradigm, the Graph is not a mirror of the code;
the Graph is the blueprint.
The code is just a "render" of the graph.
1. The "Genesis" Block
When a user asks to "Build a new generic To-Do App," the Agent
MUST NOT
start by writing
`index.html`
. It must start by defining the
Graph Topology
.
Agent Instruction:
"Do not emit file content until the Architectural Subgraph is committed."
Step A: Define the Domain Entities (The Nodes)
The Agent creates nodes representing the business concepts, not the files.
- `Node(User)`,`Node(Task)`,`Node(List)`
Step B: Define the Relationships (The Edges)
The Agent links them to define behavior.
- `User -[OWNS]-> List`
- `List -[CONTAINS]-> Task`
Step C: Scaffold the Implementation
Only now does the Agent generate the file structure
derived
from the graph.
- "Since`User`relates to`List`, I will create`User.ts`and`List.ts`with a`OneToMany`relationship."
2. The "Graph-First" Workflow (MCP)
To ensure the system stays "Graph-Native," the Agent must use specific MCP tools for every creation action.
Tool:
`scaffold_feature`
- Input:`{"feature_name": "Auth", "dependencies": ["User", "DB"]}`
- Logic:Creates`Module Node "Auth"`.Creates`Function Node "login"`.Creates`Function Node "register"`.Creates`CALLS`edges to the "DB" node.Finallycreates the`auth.js`file with stubbed functions.
  1. Creates`Module Node "Auth"`.
  2. Creates`Function Node "login"`.
  3. Creates`Function Node "register"`.
  4. Creates`CALLS`edges to the "DB" node.
  5. Finallycreates the`auth.js`file with stubbed functions.
- Why:This guarantees the graph is never "behind" the code.
Tool:
`refactor_intent`
- Input:`{"target_node_id": "893", "new_intent": "Make this async"}`
- Logic:Updates the`Symbolic`property of the node (e.g.,`is_async: true`).Queries the graph: "Who calls Node 893?"Returns a list of all Callers that now need`await`keywords added.Agent updates all files in one atomic transaction.
  1. Updates the`Symbolic`property of the node (e.g.,`is_async: true`).
  2. Queries the graph: "Who calls Node 893?"
  3. Returns a list of all Callers that now need`await`keywords added.
  4. Agent updates all files in one atomic transaction.
Part III: Agent Instructions (System Prompt)
Copy and paste these instructions into your Agent's system prompt to enable this behavior.
Plaintext
```code-container
## CORE DIRECTIVE: GRAPH-NATIVE AUTHORITY
You are an Architect-Agent operating within a Semantic-Symbolic Graph Environment.
You DO NOT treat the file system as the source of truth. The Graph is the source of truth; the File System is merely a compilation target.

## PHASE 1: EXPLORATION (READ)
When asked to analyze or fix code:
1. DO NOT read files immediately.
2. QUERY the Semantic Layer (Vector Search) to find the "Neighborhood" of the problem.
3. TRAVERSE the Symbolic Layer (Edges) to understand the "Impact Radius".
4. ONLY THEN read the Source Layer (Files) for the specific nodes identified.

## PHASE 2: CONSTRUCTION (WRITE)
When asked to create new features:
1. MENTAL MODEL: Visualize the nodes and edges first.
2. GRAPH ACTION: Use `create_node` and `create_relationship` tools to define the structure in the database.
3. CODE ACTION: Generate the code that satisfies the graph constraints.
4. VERIFICATION: Ensure the generated code explicitly imports/calls the dependencies defined in your graph.

## PHASE 3: MAINTENANCE (SYNC)
If you encounter a discrepancy between the Graph and the Code (e.g., a function exists in the file but not the graph):
1. Assume the Graph is stale.
2. Trigger the `reindex_file` tool immediately.
3. Warn the user: "Graph drift detected. Resyncing..."

```
IV. The "Bootstrapper" Script
To initialize a repository with this system immediately, run this pseudo-code logic:
Python
```code-container
def init_graph_native_repo():
    # 1. Initialize Git
    git.init()

    # 2. Spin up the Local Graph DB (e.g., Docker container)
    graph_db.start()

    # 3. Install the "Watcher" Hook
    # This ensures every 'git commit' is rejected unless the Graph is valid
    install_hook("pre-commit", script="mcp-server check-graph-integrity")

    # 4. Create the Root Node
    graph_db.create_node(type="Project", name=cwd.name)

    print("System is Graph-Native. You may now begin coding.")

```
