#!/bin/bash

# ============================================================
# KAPANIN — GitHub Label Setup
# Team: SeDuTi
#
# Usage:
#   chmod +x scripts/create-labels.sh
#   ./scripts/create-labels.sh
#
# Requirements:
#   GitHub CLI (gh)
#   Logged in with: gh auth login
# ============================================================

set -e

echo "=========================================="
echo "   KAPANIN — GitHub Label Setup"
echo "=========================================="
echo ""

# ------------------------------------------------------------
# TYPE LABELS
# Blue family
# ------------------------------------------------------------

echo "[TYPE] Creating type labels..."

gh label create "type:feature" \
  --color "1D76DB" \
  --description "New functionality or user-facing feature" \
  --force

gh label create "type:bug" \
  --color "B60205" \
  --description "Something is broken or behaving incorrectly" \
  --force

gh label create "type:design" \
  --color "0366D6" \
  --description "UI/UX, architecture, database, or system design work" \
  --force

gh label create "type:research" \
  --color "005CC5" \
  --description "Research, investigation, or technical exploration" \
  --force

gh label create "type:testing" \
  --color "54AEFF" \
  --description "Testing, validation, or quality assurance work" \
  --force

gh label create "type:documentation" \
  --color "79B8FF" \
  --description "Documentation, reports, guides, or project records" \
  --force

gh label create "type:chore" \
  --color "6F42C1" \
  --description "Maintenance or routine project work" \
  --force

gh label create "type:infrastructure" \
  --color "2188FF" \
  --description "Infrastructure, deployment, configuration, or environment work" \
  --force


# ------------------------------------------------------------
# AREA LABELS
# Purple family
# ------------------------------------------------------------

echo ""
echo "[AREA] Creating area labels..."

gh label create "area:frontend" \
  --color "7057FF" \
  --description "Frontend application and client-side development" \
  --force

gh label create "area:backend" \
  --color "8A63D2" \
  --description "Backend application and server-side development" \
  --force

gh label create "area:database" \
  --color "6F42C1" \
  --description "Database, schema, queries, and data persistence" \
  --force

gh label create "area:ai" \
  --color "5319E7" \
  --description "Artificial intelligence, machine learning, and prediction" \
  --force

gh label create "area:uiux" \
  --color "C5DEF5" \
  --description "User interface and user experience design" \
  --force

gh label create "area:networking" \
  --color "BFDADC" \
  --description "Computer networking, routing, addressing, and connectivity" \
  --force

gh label create "area:cloud" \
  --color "D4C5F9" \
  --description "Cloud infrastructure, Azure, and cloud deployment" \
  --force

gh label create "area:devops" \
  --color "E99695" \
  --description "CI/CD, GitHub Actions, automation, and development operations" \
  --force


# ------------------------------------------------------------
# MODULE LABELS
# Green family
# ------------------------------------------------------------

echo ""
echo "[MODULE] Creating module labels..."

gh label create "module:1" \
  --color "0E8A16" \
  --description "Module 1 — Group formation and problem formulation" \
  --force

gh label create "module:2" \
  --color "22863A" \
  --description "Module 2 — SDLC, Git, GitHub, and software engineering process" \
  --force

gh label create "module:3" \
  --color "34D058" \
  --description "Module 3 — Computer networking" \
  --force


# ------------------------------------------------------------
# PRIORITY LABELS
# Orange / Red family
# ------------------------------------------------------------

echo ""
echo "[PRIORITY] Creating priority labels..."

gh label create "priority:critical" \
  --color "B60205" \
  --description "Critical work that blocks the project or requires immediate attention" \
  --force

gh label create "priority:high" \
  --color "D93F0B" \
  --description "Important work that should be completed soon" \
  --force

gh label create "priority:medium" \
  --color "FBCA04" \
  --description "Normal priority work" \
  --force

gh label create "priority:low" \
  --color "F9D0C4" \
  --description "Work that can be postponed without significant impact" \
  --force


# ------------------------------------------------------------
# FINISHED
# ------------------------------------------------------------

echo ""
echo "=========================================="
echo "   🗿 KAPANIN LABEL SETUP COMPLETE"
echo "=========================================="
echo ""

echo "Labels currently configured:"
echo ""

gh label list --limit 100

echo ""
echo "Done. 🗿"