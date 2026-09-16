"""`wf` command line. Usage: wf run <building> [--level L1] [--from-stage x] [--to-stage y]"""

from __future__ import annotations

from typing import Annotated

import typer

from wf import stages
from wf.config import load_config
from wf.context import StageContext

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def run(
    building: str,
    level: Annotated[list[str] | None, typer.Option("--level", "-l", help="Level id(s); default all")] = None,
    from_stage: Annotated[str | None, typer.Option(help=f"One of {stages.STAGE_ORDER}")] = None,
    to_stage: Annotated[str | None, typer.Option(help=f"One of {stages.STAGE_ORDER}")] = None,
) -> None:
    """Run pipeline stages for a building's levels."""
    cfg = load_config(building)
    levels = [cfg.level(lv) for lv in level] if level else cfg.levels
    names = stages.select(from_stage, to_stage)
    failures: list[str] = []
    for lv in levels:
        typer.echo(f"{cfg.id} {lv.id}")
        ctx = StageContext(building=cfg, level=lv)
        for name in names:
            fn = stages.get(name)
            if fn is None:
                typer.echo(f"  {name}: not implemented yet, stopping")
                break
            try:
                fn(ctx)
            except Exception as exc:  # noqa: BLE001 -- one bad photo shouldn't stop the rest of the building
                typer.echo(f"  {name}: FAILED: {exc}", err=True)
                failures.append(f"{lv.id}/{name}")
                break
    if failures:
        typer.echo(f"failed: {', '.join(failures)} (fix overrides such as corners.json/crop.json, then re-run with --from-stage)", err=True)
        raise typer.Exit(1)


@app.command()
def stages_list() -> None:
    """List stages and whether they are implemented."""
    for name in stages.STAGE_ORDER:
        typer.echo(f"{name:10} {'ok' if stages.get(name) else '-'}")


@app.command()
def score(building: str) -> None:
    """Room-number recall/precision per level against golden.yaml (run the pipeline first)."""
    from wf.score import score_building

    for s in score_building(building):
        wrong = f" WRONG={s.accepted_wrong}" if s.accepted_wrong else ""
        wrong += f" DUPLICATES={s.duplicates}" if s.duplicates else ""
        typer.echo(
            f"{s.level:3} gold={s.gold:3} accepted={s.accepted_recall:5.0%} found-anywhere={s.any_recall:5.0%}"
            f" missing={s.missing}{wrong}"
        )


@app.command()
def serve(port: int = 8765) -> None:
    """Local API for the author tool (implemented in M2)."""
    import uvicorn

    uvicorn.run("wf.server:api", host="127.0.0.1", port=port, reload=False)
