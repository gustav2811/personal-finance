---
name: Common Orbit
description: A private household observatory for usage and money, read at home on a dark desk.
colors:
  ink: "#0b1013"
  panel: "#11191e"
  panel-raised: "#152128"
  panel-soft: "#1a2a31"
  text: "#d8e4e8"
  muted: "#83959e"
  quiet: "#5e7079"
  mint: "#a6e3a1"
  mint-strong: "#6bd794"
  amber: "#f0c674"
  coral: "#e68b78"
  blue: "#8fb9d4"
  line: "rgba(216, 228, 232, 0.13)"
  line-strong: "rgba(216, 228, 232, 0.26)"
typography:
  body:
    fontFamily: "Inter, Avenir Next, Helvetica Neue, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  display:
    fontFamily: "Inter, Avenir Next, Helvetica Neue, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(32px, 4vw, 57px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.055em"
  data:
    fontFamily: "IBM Plex Mono, SFMono-Regular, Roboto Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.03em"
rounded:
  sm: "5px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "28px"
components:
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  button-quiet-pressed:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.mint}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  nav-current:
    backgroundColor: "rgba(166, 227, 161, 0.08)"
    textColor: "{colors.mint}"
    rounded: "{rounded.md}"
    padding: "10px"
---

## Overview

Common Orbit is a dark household instrument, not an admin console. Graphite panels, vellum type, and mint, amber, and blue signals. The ledger inherits that world: a reading log on the left, an inspection plate on the right, provenance shown as a tick rather than a badge.

## Colors

Ink is the page. Panels step up through raised and soft. Mint means a decision you made or money in. Amber means a proposal that still needs a look, or a warning. Coral is money out. Blue is a FinWise observation. Muted type carries secondary facts; quiet is for ticks and rules, not body copy.

## Typography

One sans for the interface, mono for dates, amounts, and instrument labels. Display titles are tight and large. Amounts use tabular figures.

## Layout

A sticky side nav on desktop, a compact icon bar on small screens. Observatory views use a left field and a right rail. Transactions keeps that split: the log owns about two thirds, the plate the rest. The plate drops under the log below 920px.

## Elevation & Depth

Depth is a panel step and a 1px rule, not a shadow. The category picker is the exception: a raised panel with a soft offset shadow so it can float over the log.

## Shapes

Controls are 8px. Larger frames are 12px. Status marks are pills. Provenance is a 7px dot, not a lozenge.

## Components

Navigation, range controls, and review filters share the same quiet button. The selected review state turns mint. Category choice is an inline control with a tick. Accept is mint text on the row, not a dialog. The inspection plate is a column with a hairline, not a card.

## Do's and Don'ts

Do keep source facts and owned decisions visually separate. Do show the newest movement before any summary number. Don't introduce a second palette, a modal for classification, or a table of status pills.
