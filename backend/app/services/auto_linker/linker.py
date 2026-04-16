"""
Auto-Linker Service — automatically links BIM elements to schedule activities.

Matching strategies (applied in order, confidence decreases):
  1. Exact code match — element property contains activity code (confidence: 0.95)
  2. WBS + type match — WBS hierarchy + element type alignment (confidence: 0.80)
  3. Level + category match — same floor + same element category keyword (confidence: 0.65)
  4. Fuzzy name match — element name tokens match activity name tokens (confidence: 0.50)

All links are stored with is_confirmed=False so the user can review and confirm.
"""

import logging
import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Activity, BIMElement, ElementActivityLink, ElementCategory

logger = logging.getLogger(__name__)

# Keywords that map element categories to likely activity name fragments
CATEGORY_KEYWORDS: dict[ElementCategory, list[str]] = {
    ElementCategory.WALL: ["wall", "partition", "masonry", "blockwork", "drywall", "gypsum"],
    ElementCategory.SLAB: ["slab", "floor", "deck", "concrete pour", "topping"],
    ElementCategory.COLUMN: ["column", "col", "pillar"],
    ElementCategory.BEAM: ["beam", "girder", "lintel"],
    ElementCategory.DOOR: ["door", "opening"],
    ElementCategory.WINDOW: ["window", "glazing", "curtain"],
    ElementCategory.STAIR: ["stair", "staircase", "steps"],
    ElementCategory.RAILING: ["railing", "handrail", "balustrade", "guardrail"],
    ElementCategory.CEILING: ["ceiling", "soffit", "suspended ceiling"],
    ElementCategory.CURTAIN_WALL: ["curtain wall", "facade", "glazing"],
    ElementCategory.MEP: ["mep", "hvac", "plumbing", "electrical", "duct", "pipe", "conduit"],
}


class AutoLinkerService:
    """Links BIM elements to schedule activities using heuristic matching."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def link(
        self,
        bim_model_id: UUID,
        schedule_id: UUID,
        min_confidence: float = 0.4,
    ) -> int:
        """
        Run auto-linking between elements of a BIM model and activities of a schedule.
        Returns the number of links created.
        """
        # Load elements and activities
        elements = (
            await self.db.execute(
                select(BIMElement).where(BIMElement.bim_model_id == bim_model_id)
            )
        ).scalars().all()

        activities = (
            await self.db.execute(
                select(Activity).where(Activity.schedule_id == schedule_id)
            )
        ).scalars().all()

        if not elements or not activities:
            logger.warning("No elements or activities to link")
            return 0

        # Precompute activity name tokens for fuzzy matching
        activity_tokens = {
            act.id: self._tokenize(act.name + " " + act.activity_code)
            for act in activities
        }

        links_created = 0
        for element in elements:
            best_match = None
            best_confidence = 0.0
            best_method = ""
            best_details = {}

            for activity in activities:
                confidence, method, details = self._score_match(
                    element, activity, activity_tokens[activity.id]
                )
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_match = activity
                    best_method = method
                    best_details = details

            if best_match and best_confidence >= min_confidence:
                link = ElementActivityLink(
                    element_id=element.id,
                    activity_id=best_match.id,
                    confidence=round(best_confidence, 3),
                    link_method=best_method,
                    match_details=best_details,
                    is_confirmed=False,
                )
                self.db.add(link)
                links_created += 1

        await self.db.flush()
        logger.info(f"Auto-linker created {links_created} links")
        return links_created

    def _score_match(
        self,
        element: BIMElement,
        activity: Activity,
        activity_name_tokens: set[str],
    ) -> tuple[float, str, dict]:
        """
        Score how well a BIM element matches a schedule activity.
        Returns (confidence, method, details).
        """
        # Strategy 1: Exact code match
        # Check if activity code appears in element properties
        elem_text = (
            element.name + " " +
            str(element.properties) + " " +
            element.ifc_guid
        ).lower()
        act_code = activity.activity_code.lower().strip()
        if act_code and len(act_code) >= 3 and act_code in elem_text:
            return 0.95, "code_match", {"matched_code": activity.activity_code}

        # Strategy 2: Level + Category keyword match
        level_match = self._levels_match(element.level, activity.name)
        category_match = self._category_matches_activity(element.category, activity.name)

        if level_match and category_match:
            return 0.80, "level_category", {
                "element_level": element.level,
                "element_category": element.category.value,
                "matched_keywords": category_match,
            }

        # Strategy 3: Category keyword only
        if category_match:
            return 0.65, "category_keyword", {
                "element_category": element.category.value,
                "matched_keywords": category_match,
            }

        # Strategy 4: Fuzzy name token overlap
        element_tokens = self._tokenize(element.name + " " + element.level + " " + element.ifc_type)
        if element_tokens and activity_name_tokens:
            overlap = element_tokens & activity_name_tokens
            if len(overlap) >= 2:
                score = min(0.50, 0.20 + 0.10 * len(overlap))
                return score, "fuzzy_name", {
                    "overlapping_tokens": list(overlap),
                }

        return 0.0, "", {}

    def _levels_match(self, element_level: str, activity_name: str) -> bool:
        """Check if the element's level/floor is referenced in the activity name."""
        if not element_level:
            return False
        level_lower = element_level.lower()
        act_lower = activity_name.lower()

        # Direct match
        if level_lower in act_lower:
            return True

        # Extract floor numbers and compare
        level_nums = re.findall(r"\d+", level_lower)
        act_nums = re.findall(r"(?:floor|level|storey|flr|lvl)[\s_-]*(\d+)", act_lower)
        if level_nums and act_nums:
            return bool(set(level_nums) & set(act_nums))

        return False

    def _category_matches_activity(
        self, category: ElementCategory, activity_name: str
    ) -> list[str]:
        """Check if category keywords appear in the activity name."""
        keywords = CATEGORY_KEYWORDS.get(category, [])
        act_lower = activity_name.lower()
        matched = [kw for kw in keywords if kw in act_lower]
        return matched

    def _tokenize(self, text: str) -> set[str]:
        """Tokenize text into lowercase words, filtering short/stopwords."""
        stopwords = {"the", "and", "for", "with", "from", "this", "that", "are", "was", "not"}
        tokens = re.findall(r"[a-z]{3,}", text.lower())
        return set(tokens) - stopwords
