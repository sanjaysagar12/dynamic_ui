from app.schemas import ArtifactSpec
from app.services.tool_client import ToolServiceClient


def persist_spec(
    tool_client: ToolServiceClient,
    artifacts_server_url: str,
    slug: str,
    roles: list[str],
    spec: ArtifactSpec,
) -> dict:
    result = tool_client.write_artifact(
        slug=slug,
        roles=roles,
        title=spec.title,
        files={
            "index.html": spec.index_html,
            "assets/style.css": spec.css,
            "assets/app.js": spec.js,
        },
    )
    result["preview_url"] = f"{artifacts_server_url.rstrip('/')}{result['url_path']}"
    return result
