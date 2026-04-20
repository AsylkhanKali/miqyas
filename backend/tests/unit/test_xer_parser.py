"""Tests for the P6 XER file parser."""

import tempfile
from pathlib import Path

import pytest

from app.services.p6_parser.parser import XERFileParser

SAMPLE_XER = """%T\tPROJECT
%F\tproj_id\tproj_short_name\tplan_start_date\tplan_end_date\tlast_recalc_date
%R\t1001\tTEST_PROJECT\t2026-01-01 00:00\t2026-12-31 00:00\t2026-03-15 00:00
%E

%T\tPROJWBS
%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num
%R\tW1\t\tROOT\tProject Root\t0
%R\tW2\tW1\tSTRUCT\tStructural Works\t1
%R\tW3\tW1\tMEP\tMEP Works\t2
%E

%T\tTASK
%F\ttask_id\ttask_code\ttask_name\twbs_id\tstatus_code\ttarget_start_date\ttarget_end_date\tact_start_date\tact_end_date\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tphys_complete_pct\ttask_type\tdriving_path_flag\ttotal_float_hr_cnt
%R\tT1\tACT-100\tFoundation Excavation\tW2\tTK_COMPLETE\t2026-01-15 00:00\t2026-02-15 00:00\t2026-01-15 00:00\t2026-02-14 00:00\t240\t0\t100\tTT_TASK\tY\t0
%R\tT2\tACT-200\tColumn Rebar\tW2\tTK_ACTIVE\t2026-02-16 00:00\t2026-03-31 00:00\t2026-02-18 00:00\t\t320\t120\t60\tTT_TASK\tY\t-16
%R\tT3\tACT-300\tSlab Formwork Level 1\tW2\tTK_NOT_START\t2026-04-01 00:00\t2026-04-30 00:00\t\t\t200\t200\t0\tTT_TASK\tN\t40
%R\tT4\tACT-400\tHVAC Ductwork\tW3\tTK_NOT_START\t2026-05-01 00:00\t2026-06-15 00:00\t\t\t360\t360\t0\tTT_TASK\tN\t80
%R\tT5\tMS-001\tProject Milestone\tW1\tTK_NOT_START\t2026-12-31 00:00\t2026-12-31 00:00\t\t\t0\t0\t0\tTT_MILE\tY\t0
%E

%T\tTASKPRED
%F\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt
%R\tT2\tT1\tPR_FS\t0
%R\tT3\tT2\tPR_FS\t0
%R\tT4\tT3\tPR_SS\t80
%E
"""


@pytest.fixture
def sample_xer_path() -> Path:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".xer", delete=False) as f:
        f.write(SAMPLE_XER)
        return Path(f.name)


def test_xer_parse_tables(sample_xer_path: Path):
    parser = XERFileParser(sample_xer_path)
    tables = parser.parse()

    assert "PROJECT" in tables
    assert "PROJWBS" in tables
    assert "TASK" in tables
    assert "TASKPRED" in tables


def test_xer_project_table(sample_xer_path: Path):
    parser = XERFileParser(sample_xer_path)
    tables = parser.parse()

    project = tables["PROJECT"]
    assert len(project) == 1
    assert project.rows[0]["proj_short_name"] == "TEST_PROJECT"
    assert project.rows[0]["plan_start_date"] == "2026-01-01 00:00"


def test_xer_wbs_table(sample_xer_path: Path):
    parser = XERFileParser(sample_xer_path)
    tables = parser.parse()

    wbs = tables["PROJWBS"]
    assert len(wbs) == 3
    codes = [r["wbs_short_name"] for r in wbs.rows]
    assert "ROOT" in codes
    assert "STRUCT" in codes
    assert "MEP" in codes


def test_xer_task_table(sample_xer_path: Path):
    parser = XERFileParser(sample_xer_path)
    tables = parser.parse()

    tasks = tables["TASK"]
    assert len(tasks) == 5

    # Check completed task
    t1 = tasks.rows[0]
    assert t1["task_code"] == "ACT-100"
    assert t1["status_code"] == "TK_COMPLETE"
    assert t1["phys_complete_pct"] == "100"

    # Check in-progress task
    t2 = tasks.rows[1]
    assert t2["task_code"] == "ACT-200"
    assert t2["status_code"] == "TK_ACTIVE"
    assert t2["phys_complete_pct"] == "60"

    # Check milestone
    t5 = tasks.rows[4]
    assert t5["task_type"] == "TT_MILE"


def test_xer_relationships(sample_xer_path: Path):
    parser = XERFileParser(sample_xer_path)
    tables = parser.parse()

    rels = tables["TASKPRED"]
    assert len(rels) == 3

    # T2 depends on T1 (FS)
    r1 = rels.rows[0]
    assert r1["pred_task_id"] == "T1"
    assert r1["pred_type"] == "PR_FS"

    # T4 depends on T3 (SS with lag)
    r3 = rels.rows[2]
    assert r3["pred_type"] == "PR_SS"
    assert r3["lag_hr_cnt"] == "80"
