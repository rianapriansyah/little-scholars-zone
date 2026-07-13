# Tutoring Center App — System Design

## Overview

A management platform for a toddler tutoring center (30–100 children) supporting personalized teaching delivered in small fixed groups (max 6 children per teacher). Five roles: owner, admin, front desk, teacher, parent.

**Stack:** React + TypeScript + Supabase (Postgres + Auth + RLS) + MUI v5, deployed on Vercel.

---

## Version 1 — Core Records

> Goal: get every person, role, and relationship into the system accurately. Nothing works in v2 without this being solid.

### Entities
- **children** — the central record everything else links to
- **parents** (families) — one account per family, can have multiple children
- **teachers** — one account per teacher, active/inactive status
- **classrooms** — a teacher's fixed session group (day, time, max 6 children)
- **children_classrooms** — enrollment history linking a child to a classroom, with date range

### Schema

#### `families`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | family display name |
| contact_phone | text | |
| contact_email | text | |
| auth_user_id | uuid | FK → Supabase auth.users |
| created_by | uuid | admin/front desk who enrolled them |
| created_at | timestamptz | |

#### `children`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| family_id | uuid | FK → families |
| full_name | text | |
| birthdate | date | |
| notes | text | nullable |
| active | boolean | currently enrolled at center |
| created_at | timestamptz | |

#### `teachers`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| full_name | text | |
| contact_phone | text | |
| auth_user_id | uuid | FK → Supabase auth.users |
| active | boolean | currently employed |
| created_at | timestamptz | |

#### `classrooms`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| teacher_id | uuid | FK → teachers |
| label | text | e.g. "Teacher Rina – Tuesday 10am" |
| days_of_week | text[] | one or more of Monday … Sunday |
| time_start | time | |
| time_end | time | nullable (existing rows predate this column) |
| capacity | int | default 6 |
| active | boolean | |
| created_at | timestamptz | |

#### `children_classrooms`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| child_id | uuid | FK → children |
| classroom_id | uuid | FK → classrooms |
| started_at | date | |
| ended_at | date | nullable — **null = currently active** |
| end_reason | text | nullable: "switched teacher", "aged up", "left center" |
| created_by | uuid | audit trail |
| created_at | timestamptz | |

**Constraint:** partial unique index on `(child_id) WHERE ended_at IS NULL` — one active classroom per child at all times.

### Business Logic
- **Capacity check** — before enrolling a child, count active enrollments for that classroom; reject if ≥ capacity
- **Switch classroom** — close current row (`ended_at = now()`) + open new row, atomic RPC so history is never broken
- **Current classroom** — `WHERE child_id = X AND ended_at IS NULL`; no separate flag needed

### Roles (v1)
| Role | children | families | teachers | classrooms | children_classrooms |
|---|---|---|---|---|---|
| owner / admin / front_desk | full | full | full | full | full |
| teacher | read (own children only) | none | read own profile | read own | read own |
| parent | read (own children only) | read own | none | read (current) | read (own children) |

---

## Version 2 — Operations Layer

> Goal: support day-to-day workflows — tracking what each child is doing, what teachers assign and review, and what families owe.

### New Entities
- **children_tracker** — attendance and session log per child per session date
- **homework** — assignments given to a child by their teacher
- **teacher_reviews** — teacher's periodic written review/progress note per child
- **payment_history** — invoice and payment records at the family level

### Schema (additions)

#### `children_tracker`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| child_id | uuid | FK → children |
| classroom_id | uuid | FK → classrooms |
| session_date | date | |
| present | boolean | |
| notes | text | optional session notes |
| logged_by | uuid | teacher or front desk |
| created_at | timestamptz | |

#### `homework`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| child_id | uuid | FK → children |
| teacher_id | uuid | FK → teachers |
| title | text | |
| description | text | |
| due_date | date | |
| submitted | boolean | default false |
| submitted_at | timestamptz | nullable |
| created_at | timestamptz | |

#### `teacher_reviews`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| child_id | uuid | FK → children |
| teacher_id | uuid | FK → teachers |
| review_date | date | |
| content | text | written progress review |
| visible_to_parent | boolean | teacher controls when parent sees it |
| created_at | timestamptz | |

#### `payment_history`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| family_id | uuid | FK → families |
| child_id | uuid | nullable, for per-child itemization |
| amount | numeric | |
| status | text | "paid" / "pending" / "overdue" |
| due_date | date | |
| paid_at | timestamptz | nullable |
| notes | text | nullable |
| created_at | timestamptz | |

### Role additions (v2)
| Role | children_tracker | homework | teacher_reviews | payment_history |
|---|---|---|---|---|
| owner / admin / front_desk | full | full | full | full |
| teacher | read/write (own children) | read/write (own children) | read/write (own children) | none |
| parent | read (own children) | read (own children) | read (own, if visible_to_parent) | read (own family) |

---

## Version 3 — TBD

> To be defined. Possible directions based on what's known so far:

- **Growth log** — physical measurements (height, weight), developmental milestones tracked over time per child
- **Parent portal enhancements** — notifications (WhatsApp via Fonnte?) when a review is published or payment is due
- **Reports & analytics** — attendance trends, teacher workload, payment summaries for owner
- **Curriculum / lesson plans** — since material is personalized per child, a lightweight lesson plan builder per child per teacher
- **Multi-branch support** — if the center expands to more than one location

> These will be scoped once v1 and v2 are live and real usage reveals what's actually needed.

---

## Build Order

| Phase | What gets built |
|---|---|
| V1 Sprint 1 | `families`, `children`, `teachers` — CRUD + auth |
| V1 Sprint 2 | `classrooms`, `children_classrooms` — enrollment + switch + capacity RPC |
| V1 Sprint 3 | RLS for all 4 roles, parent and teacher portal views |
| V2 Sprint 1 | `children_tracker` — attendance logging (teacher) + history view (parent) |
| V2 Sprint 2 | `homework` — assign (teacher), view/mark submitted (parent or teacher) |
| V2 Sprint 3 | `teacher_reviews` — write (teacher), publish + view (parent) |
| V2 Sprint 4 | `payment_history` — admin entry, family read-only view |
| V3 | TBD |

---

## Open Decisions (before V2 build)

- **Payment model** — per-session, monthly flat fee, or package/credit-based? Affects `payment_history` structure
- **Growth log fields** — which measurements/milestones matter for your center's curriculum
- **Homework submission** — do parents submit via app, or just mark it done verbally and teacher ticks it off?
- **Notifications** — does v2 need WhatsApp alerts (Fonnte) for payment due / new review published, or is that v3?
