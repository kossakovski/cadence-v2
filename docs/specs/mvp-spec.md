Cadence – MVP Specification (Fractal Model v1)

Version: 1.0
Date: December 2025
Status: Final Draft
Owner: Dmitri K.

1. Purpose

This document defines the minimum viable product (MVP) for the Cadence execution system, including:

Conceptual model (Projects → Workstreams → Tasks → Cycles)

Data structures and relationships

Execution logic (“cycle engine”)

Aggregation logic for reviews

Onboarding target schema

MVP UI behaviors

Explicit non-goals for v1

This specification serves as the single source of truth for engineering, AI onboarding, and UX design.

2. Product Philosophy — Fractal Execution

Cadence models execution as a fractal rhythm:

Big long-term goals → Projects

Thematic tracks of work → Workstreams

Units of accountability → Tasks

Time-based commitments → Cycles

Weekly/monthly rituals → Reviews

Only Tasks hold cycles in MVP.
Projects and Workstreams provide structure and context, not time-tracked commitments.

This maintains simplicity while allowing enormous future extensibility.

3. Hierarchy Model (Three Levels)

Cadence MVP defines a fixed three-level hierarchy:

Project  →  Workstream  →  Task  →  Cycle


Higher levels organize and contextualize; only Tasks own cycles.

3.1 Project

Definition:
Top-level planning unit for missions spanning quarters or years.
“What are we trying to achieve at the largest scale?”

Fields (MVP):

id

name

description?

owner?

workstreams[]

Behavior:

Projects do not own cycles in MVP

Project Review aggregates Task cycles underneath by scope

Future capabilities:

Quarterly cycles

OKRs

Multi-layer sub-workstreams

3.2 Workstream

Definition:
A thematic domain of work within a project.
“What area of work is this?”

Example: Mechanical Engineering, UX, Fundraising.

Fields:

id

projectId

name

lead

description?

milestone?

milestoneDate?

tasks[]

Behavior:

No cycles in MVP

Workstream Review shows only highlighted task updates

Optional milestone context

Future capabilities:

Workstream cycles

Say/Do analytics

Blocking analysis

3.3 Task

Definition:
Atomic unit of accountability.
“What exactly is someone committing to this period?”

Fields:

id

workstreamId

name

owner

cadence (“daily” | “weekly” | “biweekly” | “monthly”)

lifecycle (“active” | “inactive”)

cycles[]

Behavior:

Only entity with cycles

Appears in Task, Workstream, and Project scopes

Lifecycle determines participation in cadence

Future capabilities:

Subtasks

Priorities, tags

Dependencies

4. Cycle Model (Core Engine)

Each Task has a list of immutable cycles, following:

Previous Plan  →  Actuals  →  Next Plan


Exactly one cycle per task is open at any time.

4.1 Cycle Fields

index (0,1,2…)

status (“open” | “closed”)

startDate

endDate?

previousPlan

actuals

nextPlan

owner

reviewed (boolean)

highlightForWorkstream (boolean)

4.2 Opening a New Cycle

Triggered by Complete Period Update.

Logic:

Set previous cycle → status = closed, endDate = today

Create new cycle:

index = last.index + 1

startDate = next day after last.endDate

previousPlan = last.nextPlan (or empty if none)

actuals = ""

nextPlan = ""

reviewed = false

4.3 Closing a Cycle

When closing:

endDate = today

status = closed

Data becomes read-only

5. Task Lifecycle

MVP uses a unified lifecycle:

active  ↔  inactive


No separate “pause” vs “retire”.

5.1 Deactivating a Task

Close its open cycle

Set lifecycle = "inactive"

Remove from:

Open view

Period completion flow

Owner summaries

5.2 Activating a Task

Set lifecycle = "active"

Create a new open cycle:

startDate = today

previousPlan = last.nextPlan (or empty)

actuals = ""

nextPlan = ""

6. Aggregation Model

Cadence MVP uses highlight-based rollup.

6.1 Workstream Review

Workstream Review shows:

All active tasks

All cycles for this period where highlightForWorkstream = true

Optional milestone context

There is no automatic summarization.

6.2 Project Review

Project Review shows:

All workstreams under the project

All tasks under those workstreams

Their current period cycles

Highlighted cycles (optional emphasis)

Projects do NOT own cycles in MVP.

7. Navigation Model

Cadence supports multiple navigation scopes:

7.1 Project Scope

Shows tasks across all workstreams

Period completion applies to all active tasks

WS context shown but not editable here

7.2 Workstream Scope

Shows tasks within that WS

WS Review uses highlighted cycles

7.3 Task Scope

Full cycle history

Editable open cycle

7.4 Owner Scope (future)

Shows all tasks owned by a person

8. Onboarding Target Schema

(Stable JSON Structure v1)

LLM onboarding (Stage 1 + Stage 2) must output this structure:

{
  "projects": [
    {
      "name": "Project X",
      "owner": "Dmitri",
      "workstreams": [
        {
          "name": "Workstream A",
          "lead": "Aria",
          "milestone": "MVP Ready",
          "milestoneDate": "2026-02-15",
          "tasks": [
            {
              "name": "Design Setup Wizard",
              "owner": "Aria",
              "cadence": "weekly"
            }
          ]
        }
      ]
    }
  ]
}


The app then:

Instantiates this as internal CadenceNode structures

Creates initial open cycles for tasks

Marks tasks as active

9. UI Behaviors (MVP)
9.1 Task Row Controls

Edit text fields

Toggle highlightForWorkstream

Deactivate task

View history

Activate task (when inactive)

9.2 Inactive Tasks List

Each scope includes:

Inactive tasks (N) ▸


Expanded:

Inactive tasks (N) ▾
[ Task A ] [ Task B ] [ Task C ]


Tap → Activate task.

9.3 Period Completion

Only active tasks participate

Applies within current scope (Project/WS)

Creates consistent cycle boundaries

10. Out of Scope (Future Releases)

NOT included in MVP:

Subtasks

Workstream cycles

Project cycles

Dependencies

Notifications / reminders

Multi-user or team sharing

Calendar integration

Analytics or Say/Do ratios

LLM summarization

Priorities or tags

Timeline/Gantt views

Backlog management

11. Risks & Mitigations
Risk 1 — Weak WS summary

Mitigation: highlight system + later WS summary field.

Risk 2 — Users forget highlights

Mitigation: suggest highlight when none selected.

Risk 3 — Users want WS cadence

Mitigation: future WS cycles compatible with MVP.

Risk 4 — Rigid hierarchy

Mitigation: internal tree supports unlimited levels in future.

Risk 5 — Confusing cycle transitions

Mitigation: allow per-task toggles in period closing flow.

12. Summary

Cadence MVP establishes a strong, extensible foundation:

3-level hierarchy (Project → Workstream → Task)

Immutable cycle engine

Unified active/inactive lifecycle

Highlight-driven aggregation

Stable onboarding schema

Minimal, clear UI

This is a lean but complete execution OS ready for LLM onboarding, future analytics, and multi-level expansion.