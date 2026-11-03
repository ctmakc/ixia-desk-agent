# IXIA Desk Agent

An agent that files a law firm's new enquiry into the firm's web portal from a throwaway, sealed browser on Vultr. A person approves the final booking click.

Built for **Vultr: Agent Rush** (lablab.ai, 3–8 Nov 2026), Challenge 1 "Blast Radius Zero", Pattern B: sandboxed browser use with vision checks and human approval.

> Status: work in progress during the event window. Numbers appear in this README only after they are measured on the Vultr deployment.

## How one enquiry flows

1. Enquiry arrives in IXIA. IXIA Guardrails decides: reply, hold for a human, or block.
2. A planning model on Vultr Serverless Inference returns a step list from a fixed action set (`goto`, `fill`, `click`, `select_slot`, `screenshot`). Anything else is rejected by the controller.
3. The controller mints a one-task portal token (create one contact, request one booking, 10-minute TTL).
4. A fresh Docker container with Chromium and Playwright runs the steps. It has no API keys, a read-only root filesystem, all capabilities dropped, memory / process / wall-clock limits, and a network with no route out except an egress proxy that allows only the portal host.
5. After each step a vision model reads the screenshot and confirms the page state; a failed check goes back to the planner (max 2 retries).
6. Before the final "Book" click the run pauses in IXIA's review queue. Approve runs the click; Reject books nothing.
7. Teardown always runs: container removed, token revoked, proxy log saved, audit entry appended to a SHA-256 hash chain.

## Containment checks

`containment/run.sh` creates its own internal network, an allowlist egress proxy and probe containers, then checks seven primitives: allowed host reachable through the proxy, other host refused, direct connection without route, no secret-like variables, runaway loop killed, memory bomb OOM-killed, fork bomb stopped by the pids limit. It removes everything it created.

```bash
bash containment/run.sh
```

Results on the Vultr VM are recorded in `containment/RESULTS.md`.

## What existed before the event

- **IXIA** — our AI lead-intake platform for service firms (ixia.online).
- **IXIA Guardrails** — reply gate with sensitive-data and prompt-injection checks, review queue and SHA-256 audit log. MIT, https://github.com/ctmakc/ixia-guardrails, built 16–19 Oct 2026. Demo: https://guardrails.ixia.online
- Before 3 Nov we checked the container limits and the allowlist proxy on our own server (the script now in `containment/`) and wrote the Vultr deployment plan.

Built during the event (3–8 Nov 2026): planner and executor, sandbox lifecycle, vision checks, approval step, demo portal, move of Guardrails' model calls to Vultr Serverless Inference, deployment on Vultr. The commit history shows the order.

## License

MIT, see `LICENSE`.
