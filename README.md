# Berkeley Wayfinder

Indoor directions for UC Berkeley buildings, shown on a 3D model of the building. Floor plans are extracted from the directory placards posted inside each building.

Status: early development, with **Wheeler Hall** as the first building. See [`PLAN.md`](PLAN.md) for the roadmap and [`CLAUDE.md`](CLAUDE.md) for contributor and agent instructions.

## Layout
- `apps/nav`: public navigation app (Next.js, 3D via react-three-fiber)
- `apps/author`: local desk tool for correcting and accepting extracted floor data
- `packages/schema`, `packages/geometry`, `packages/routing`: shared TypeScript
- `pipeline/`: Python placard-photo → floor-graph pipeline
- `data/`: raw photos, pipeline work files, canonical building data

## Quick start
```bash
pnpm install
pnpm dev:nav        # http://localhost:3000
cd pipeline && uv sync && uv run wf run wheeler --level L1 --to-stage ingest
```

MIT licensed.
