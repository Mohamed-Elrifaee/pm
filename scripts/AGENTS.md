# Scripts Guide

## Scope

This directory contains local Docker lifecycle scripts for each operating system.

## Current Scripts (Part 2)

- Windows:
  - `start-windows.ps1`
  - `stop-windows.ps1`
- Linux:
  - `start-linux.sh`
  - `stop-linux.sh`
- macOS:
  - `start-mac.sh`
  - `stop-mac.sh`

## Behavior

- Start scripts:
  - Build image `pm-mvp:local` from `pm/Dockerfile`
  - Remove existing `pm-mvp-app` container if it exists
  - Run container on `http://127.0.0.1:8000`
  - Load `pm/.env` if present
- Stop scripts:
  - Stop and remove `pm-mvp-app` if present

## Notes for Future Work

- Keep script names explicit by OS.
- If ports/image names change, update all scripts consistently.
