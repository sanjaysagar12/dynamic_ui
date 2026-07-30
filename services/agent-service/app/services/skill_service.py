import re
import shutil
from pathlib import Path

SKILL_FILENAME = "SKILL.md"

_NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.DOTALL)


class InvalidSkillNameError(Exception):
    pass


class SkillNotFoundError(Exception):
    pass


class SkillAlreadyExistsError(Exception):
    pass


def validate_skill_name(name: str) -> None:
    if not _NAME_PATTERN.match(name):
        raise InvalidSkillNameError(
            f"Invalid skill name '{name}': must be lowercase kebab-case (letters, digits, hyphens only, "
            "no leading/trailing/double hyphens)"
        )


def _skills_dir(artifacts_root: Path) -> Path:
    return artifacts_root / ".opencode" / "skills"


def _skill_file(artifacts_root: Path, name: str) -> Path:
    return _skills_dir(artifacts_root) / name / SKILL_FILENAME


def _serialize(name: str, description: str, content: str) -> str:
    # Matches the format this repo's own root .opencode/skills/*/SKILL.md
    # already uses — the same convention opencode discovers directly.
    escaped_description = description.replace('"', '\\"')
    return f'---\nname: {name}\ndescription: "{escaped_description}"\n---\n\n{content.strip()}\n'


def _parse(raw: str) -> dict:
    match = _FRONTMATTER_PATTERN.match(raw)
    if not match:
        raise ValueError("Malformed SKILL.md: missing '---' frontmatter block")
    frontmatter, content = match.group(1), match.group(2)

    name = ""
    description = ""
    for line in frontmatter.splitlines():
        if line.startswith("name:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("description:"):
            value = line.split(":", 1)[1].strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1].replace('\\"', '"')
            description = value

    return {"name": name, "description": description, "content": content.strip()}


def list_skills(artifacts_root: Path) -> list[dict]:
    skills_dir = _skills_dir(artifacts_root)
    if not skills_dir.is_dir():
        return []

    results = []
    for entry in sorted(skills_dir.iterdir()):
        skill_file = entry / SKILL_FILENAME
        if not skill_file.is_file():
            continue
        try:
            parsed = _parse(skill_file.read_text(encoding="utf-8"))
        except ValueError:
            continue
        results.append({**parsed, "name": parsed["name"] or entry.name})
    return results


def read_skill(artifacts_root: Path, name: str) -> dict | None:
    validate_skill_name(name)
    skill_file = _skill_file(artifacts_root, name)
    if not skill_file.is_file():
        return None
    parsed = _parse(skill_file.read_text(encoding="utf-8"))
    return {**parsed, "name": parsed["name"] or name}


def create_skill(artifacts_root: Path, name: str, description: str, content: str) -> dict:
    validate_skill_name(name)
    skill_file = _skill_file(artifacts_root, name)
    if skill_file.exists():
        raise SkillAlreadyExistsError(f"Skill '{name}' already exists")

    skill_file.parent.mkdir(parents=True, exist_ok=True)
    skill_file.write_text(_serialize(name, description, content), encoding="utf-8")
    return {"name": name, "description": description, "content": content}


def update_skill(artifacts_root: Path, name: str, description: str, content: str) -> dict:
    validate_skill_name(name)
    skill_file = _skill_file(artifacts_root, name)
    if not skill_file.is_file():
        raise SkillNotFoundError(f"Skill '{name}' not found")

    skill_file.write_text(_serialize(name, description, content), encoding="utf-8")
    return {"name": name, "description": description, "content": content}


def delete_skill(artifacts_root: Path, name: str) -> None:
    validate_skill_name(name)
    skill_dir = _skill_file(artifacts_root, name).parent
    if not skill_dir.is_dir():
        raise SkillNotFoundError(f"Skill '{name}' not found")

    shutil.rmtree(skill_dir)
