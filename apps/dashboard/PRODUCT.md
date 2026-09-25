# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js App Router with TypeScript, Supabase browser client, and a
charting layer chosen for interactive time-series visualisation and Vercel
deployment.

## Users

Gustav and Cara, using the dashboard at home to scan household trends, compare
energy and money, and investigate unusual usage.

## Product Purpose

A private household observatory that brings consumption and financial data
together in one read-only visual experience. Success means making the
relationship between energy usage, device behaviour, and cost obvious at a
glance, while preserving enough detail to investigate.

## Positioning

This is a household-owned view across physical usage and financial consequence:
the same place shows what the home consumed, what caused it, and what it cost.

## Operating Context

The source of truth is the existing finance-data Supabase project. Household
consumption lives in its own `consumption` schema and is ingested by existing
ISMRT and smart-plug runners. The dashboard is read-only for now and will
eventually deploy to Vercel.

## Capabilities and Constraints

- Show electricity, water billing, device readings, wallet charges, deposits,
  and financial data as related but distinguishable facts.
- Use direct browser reads through an authenticated Supabase role; never expose
  a service-role key in the web app.
- Google sign-in only, restricted to `gustav@klingbiel.org` and
  `cara@klingbiel.org`.
- Keep the first surface mostly read-only; ingestion remains outside the
  dashboard.
- Preserve native-resolution data and source provenance for investigation.
- Support responsive desktop and mobile web layouts.

## Evidence on Hand

- Existing Supabase consumption schema and ingestion migrations under
  `supabase/migrations/`.
- ISMRT wallet, meter, utility, and financial extracts under
  `data/consumption/ismrt/`.
- Historical household and espresso readings under
  `data/consumption/electricity/raw/`.
- Existing finance-data ingestion code under `apps/` and `libs/`.

## Product Principles

- Start with the household question, not the source system.
- Show physical usage and financial consequence together without conflating
  them.
- Make unusual days easy to spot and easy to investigate.
- Prefer owned, auditable data over opaque summaries.

