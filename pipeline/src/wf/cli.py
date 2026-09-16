"""`wf` command line. Usage: wf run <building> [--level L1] [--from-stage x] [--to-stage y]"""

from __future__ import annotations

from typing import Annotated

import typer

from wf import stages
from wf.config import load_config

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
    for lv in levels:
        typer.echo(f"{cfg.id} {lv.id}")
        ctx = stages.StageContext(building=cfg, level=lv)
        for name in names:
            fn = stages.get(name)
            if fn is None:
                typer.echo(f"  {name}: not implemented yet, stopping")
                break
            fn(ctx)


@app.command()
def stages_list() -> None:
    """List stages and whether they are implemented."""
    for name in stages.STAGE_ORDER:
        typer.echo(f"{name:10} {'ok' if stages.get(name) else '-'}")


@app.command()
def serve(port: int = 8765) -> None:
    """Local API for the author tool (implemented in M2)."""
    import uvicorn

    uvicorn.run("wf.server:api", host="127.0.0.1", port=port, reload=False)
