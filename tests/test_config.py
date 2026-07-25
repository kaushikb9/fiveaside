import json

import pytest
from pydantic import ValidationError

from touchline.config import TouchlineConfig, load_config

EXAMPLE = {
    "club": {"name": "Chelsea", "code": "CHE", "subreddit": "chelseafc"},
    "competitions": ["PL", "CL"],
    "timezone": "Asia/Kolkata",
    "feeds": [
        {"label": "The Guardian Football", "url": "https://www.theguardian.com/football/rss"}
    ],
    "voice": "calm, sharp, no hype",
}


def test_load_config_roundtrip(tmp_path):
    path = tmp_path / "touchline.config.json"
    path.write_text(json.dumps(EXAMPLE), encoding="utf-8")
    cfg = load_config(path)
    assert cfg.club.name == "Chelsea"
    assert cfg.club.code == "CHE"
    assert cfg.club.subreddit == "chelseafc"
    assert cfg.competitions == ["PL", "CL"]
    assert cfg.timezone == "Asia/Kolkata"
    assert cfg.feeds[0].label == "The Guardian Football"
    assert cfg.voice.startswith("calm")


def test_defaults_are_optional(tmp_path):
    path = tmp_path / "touchline.config.json"
    path.write_text(
        json.dumps({"club": {"name": "Chelsea", "code": "CHE"}, "competitions": ["PL"]}),
        encoding="utf-8",
    )
    cfg = load_config(path)
    assert cfg.timezone == "UTC"
    assert cfg.feeds == []
    assert cfg.voice == ""
    assert cfg.club.subreddit is None


def test_empty_competitions_rejected():
    with pytest.raises(ValidationError):
        TouchlineConfig(club={"name": "Chelsea", "code": "CHE"}, competitions=[])


def test_repo_config_is_valid():
    cfg = load_config("touchline.config.json")
    assert cfg.competitions
