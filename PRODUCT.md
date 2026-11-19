# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Native desktop app (Herdr, GPUI). Runs on macOS and Linux, usually on more than one machine at once (a desktop and a laptop, say). UI is written as Herdr mods in JavaScript; no HTML or CSS.

## Users

One person juggling several projects at once (their own companies, client work, side projects), often driving many coding agents (Claude Code, Codex) in parallel across many repos and more than one machine.

## Product Purpose

A personal Herdr layout that turns a pile of terminals into an organized portfolio of work. The working unit is the project (a company, a client, a side project), split into subprojects (microservices, repos). Every agent session is listed under the project and subproject it works on, with its live status. Each project has a small shared task board that says what is missing, what is in progress and which agent is doing it.

Success: at a glance, the person knows which agents need them, what each agent is working on, and what is left to do per project, from any machine.

## Positioning

Herdr's default groups work by machine and space. This layout groups by project across machines, and ties each agent session to a task on a board shared by all of them.

## Operating Context

- Long sessions, many agents in parallel, frequent switching between projects.
- Every machine can drive agents on any other through herdr-core; the board must look the same from all of them.
- Repos live at `~/git/<repo>` on every machine.

## Capabilities and Constraints

- Shared data (projects, subprojects, tasks) in Postgres (Neon, or self-hosted on a Pi), reached over HTTPS from the mods.
- Agent status words: working, blocked (needs the person), done (finished unseen), idle.
- No horizontal tab bar: every session is a row in the left pane.
- Task columns: To do, In progress, Review, Done.

## Brand Commitments

- Dracula color theme (https://draculatheme.com/spec).

## Product Principles

1. The project is the unit; machines are a detail on each row.
2. Status first: anything that needs the person is visible without scrolling or unfolding.
3. Every agent session can say which task it is doing.
4. Organizing takes one or two clicks, never a form to fill before work can start.
