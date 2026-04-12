---
name: prd
description: "Draft a benchmark research harness brief. Legacy skill name kept for compatibility."
user-invocable: true
---

# Research Harness Brief Generator

This skill keeps the old `/prd` name, but its purpose is to draft a research harness brief that will be converted into `research_program.json`.

## The Job

Generate a brief that defines:
- the research question
- the researcher's background and hard requirements
- the benchmark
- the baseline / official best
- the allowed search space
- the forbidden moves
- the staged autonomous harness
- the post-review manual stages
- the candidate research items

## Required Sections

### 1. Research Question
- who proposed the question
- exact problem statement
- success definition
- non-goals

### 2. Researcher Context
- research background
- hard requirements
- available resources
- collaboration boundary
### 3. Benchmark Box
- benchmark name
- split
- primary metric
- secondary constraints

### 4. Baseline
- current baseline
- current best official result
- what that method is doing

### 5. Taste / Complexity Rules
- what counts as a clean idea
- what counts as unjustified complexity
- what should be rejected immediately
- what makes the idea strong enough to merit human review

### 6. Harness Stages
- researcher intake
- problem framing
- benchmark overview
- literature review
- `idea.md`
- validation plan
- early exploration
- idea convergence
- user review gate
- implementation
- tuning

### 7. Candidate Research Items

Each item should specify:
- stage
- hypothesis
- deliverables
- acceptance criteria
- whether it requires user intervention

## Writing Rules

- Keep the brief narrow.
- Do not allow the agent to jump straight to implementation.
- Require user intake before autonomous work starts.
- Make `idea.md` explicit.
- Make early-exploration artifacts explicit under `experiments/early-exploration/`.
- Treat negative evidence as a first-class outcome.
- Insert an explicit user-review stop before implementation or tuning.
