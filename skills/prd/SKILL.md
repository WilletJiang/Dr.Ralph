---
name: prd
description: "Draft a Dr.Ralph research harness brief. Legacy skill name kept for compatibility."
user-invocable: true
---

# Research Harness Brief Generator

This skill keeps the old `/prd` name, but its purpose is to draft a Dr.Ralph research harness brief that will later be converted into `research_program.json`.

## First Decide The Research Mode

Choose the active `researchMode` before writing the brief:

- `experimental_research` for empirical, evaluation-driven, or systems work where decisive evidence comes from measurements
- `theoretical_research` for concept-, theorem-, or conjecture-level work where Lean-backed checks should shape belief

Do not assume every project is benchmark-driven, GPU-driven, or theorem-driven.

## The Job

Generate a brief that defines:

- the active research mode
- the research question
- the researcher's background and hard requirements
- the relevant validation or evaluation box
- the allowed search space
- the forbidden moves
- the staged autonomous harness
- the post-review manual stages, if any
- the candidate research items

Only include mode-specific sections when they are genuinely needed:

- experimental briefs may include benchmark, baseline, and official-result sections
- theoretical briefs may include definition, conjecture, proof-pressure, and Lean-validation sections

## Required Sections

### 1. Research Mode

- whether this is `experimental_research` or `theoretical_research`
- why that mode is the right fit

### 2. Research Question

- who proposed the question
- exact problem statement
- success definition
- non-goals

### 3. Researcher Context

- research background
- hard requirements
- available resources
- collaboration boundary

### 4. Validation Box

Write the section in a mode-consistent way.

For `experimental_research`, include things like:

- evaluation setup
- benchmark or task box, if relevant
- primary metric
- constraints that make fake wins invalid

For `theoretical_research`, include things like:

- key definitions or objects
- conceptual bottlenecks
- what would count as real progress
- where Lean-backed checks should apply

### 5. Existing Baseline Or Prior Work

- the closest existing methods, results, or formulations
- what they actually achieve
- why they are insufficient for this problem

Do not force an "official best benchmark result" section when the project is not benchmark-centered.

### 6. Taste / Complexity Rules

- what counts as a clean idea
- what counts as unjustified complexity
- what should be rejected immediately
- what makes the idea strong enough to merit human review

### 7. Harness Stages

For `experimental_research`, normally include:

- researcher intake
- problem framing
- evaluation framing
- literature review
- `idea.md`
- validation plan
- early exploration
- idea convergence
- user review gate
- implementation and tuning only if explicitly post-review

For `theoretical_research`, normally include:

- researcher intake
- problem framing
- concept framing
- literature review
- `idea.md`
- proof strategy
- Lean-backed formalization
- idea convergence
- user review gate

### 8. Candidate Research Items

Each item should specify:

- stage
- hypothesis
- deliverables
- acceptance criteria
- whether it requires user intervention

## Writing Rules

- Keep the brief narrow.
- Set `researchMode` explicitly and keep every section consistent with it.
- Do not allow the agent to jump straight to implementation.
- Require user intake before autonomous work starts.
- Make `idea.md` explicit.
- Make early-exploration artifacts explicit under `experiments/early-exploration/`.
- Treat negative evidence as a first-class outcome.
- Insert an explicit user-review stop before implementation or tuning.
- For experimental work, require honest evaluation and reject metric gaming.
- For theoretical work, require crisp definitions, explicit proof pressure, and real Lean-backed validation for nontrivial claims.
