---
name: prd
description: "Draft a benchmark research harness brief. Legacy skill name kept for compatibility."
user-invocable: true
---

# Research Harness Brief Generator

This skill keeps the old `/prd` name, but its purpose is to draft a research harness brief that will be converted into `research_program.json`.

## The Job

Generate a brief that defines:
- the benchmark
- the baseline / official best
- the allowed search space
- the forbidden moves
- the staged harness
- the candidate research items

## Required Sections

### 1. Benchmark Box
- benchmark name
- split
- primary metric
- secondary constraints

### 2. Baseline
- current baseline
- current best official result
- what that method is doing

### 3. Taste / Complexity Rules
- what counts as a clean idea
- what counts as unjustified complexity
- what should be rejected immediately

### 4. Harness Stages
- benchmark overview
- literature review
- `idea.md`
- early validation
- implementation
- tuning

### 5. Candidate Research Items

Each item should specify:
- stage
- hypothesis
- deliverables
- acceptance criteria

## Writing Rules

- Keep the brief narrow.
- Do not allow the agent to jump straight to implementation.
- Make `idea.md` explicit.
- Make validation artifacts explicit.
- Treat negative evidence as a first-class outcome.
