import unittest
from io import BytesIO
from unittest import mock
from unittest.mock import MagicMock

from PIL import Image, ImageDraw

from gfa_product_authority import (
    INTENT_MOVE,
    INTENT_SCALE_DOWN,
    INTENT_SCALE_UP,
    JOKUM_DEFAULT_SCALE,
    PRODUCT_AUTHORITY_AVAILABLE,
    PRODUCT_AUTHORITY_UNAVAILABLE,
    PRODUCT_AUTHORITY_UNAVAILABLE_CODE,
    ROUTE_MARKED_PRODUCT_ASSET_EDIT,
    SOURCE_CONTENT_CENTER,
    SOURCE_PERSISTED,
    SOURCE_TRACKED,
    object_workspace_from_user_mark,
    parse_marked_product_intent,
    placement_bbox_from_workspace,
    public_authority_record,
    resolve_product_authority,
    sku_id_from_generation_payloads,
)


def _png(image: Image.Image) -> bytes:
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _ring_mask(size: int = 64, box=(28, 30, 58, 58), width: int = 3) -> bytes:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle(box, outline=(255, 255, 255, 255), width=width)
    return _png(image)


class GfaProductAuthorityTest(unittest.TestCase):
    def test_jokum_scale_up_uses_approved_default(self) -> None:
        intent = parse_marked_product_intent("선택한 제품 이미지 사이즈가 너무 작다. 해당 제품 이미지 사이즈를 조금 키워줘")
        self.assertTrue(intent["matched"])
        self.assertEqual(intent["op"], INTENT_SCALE_UP)
        self.assertEqual(intent["factor"], JOKUM_DEFAULT_SCALE)
        self.assertTrue(intent["jokumDefault"])
        self.assertEqual(intent["route"], ROUTE_MARKED_PRODUCT_ASSET_EDIT)
        self.assertEqual(intent["productInstanceCount"], 1)

    def test_percent_and_move_and_scale_down_plumbing(self) -> None:
        percent = parse_marked_product_intent("제품을 20% 키워줘")
        self.assertEqual(percent["op"], INTENT_SCALE_UP)
        self.assertAlmostEqual(percent["factor"], 1.20, places=4)
        down = parse_marked_product_intent("제품을 조금 줄여줘")
        self.assertEqual(down["op"], INTENT_SCALE_DOWN)
        self.assertEqual(down["factor"], JOKUM_DEFAULT_SCALE)
        move = parse_marked_product_intent("제품을 오른쪽으로 조금 이동해줘")
        self.assertEqual(move["op"], INTENT_MOVE)
        self.assertGreater(move["moveDxRatio"], 0)
        color = parse_marked_product_intent("제품 색감만 따뜻하게")
        self.assertFalse(color["matched"])
        hair = parse_marked_product_intent("머리를 조금 키워줘")
        self.assertFalse(hair["matched"])

    def test_closed_ring_becomes_workspace_not_whole_canvas(self) -> None:
        workspace = object_workspace_from_user_mark(_ring_mask(), target_size=(64, 64), close_px=5)
        self.assertTrue(workspace["closedRing"])
        self.assertFalse(workspace["fillsWholeCanvas"])
        self.assertGreater(workspace["enclosedPixels"], 0)
        self.assertLess(workspace["workspaceRatio"], 0.5)
        self.assertEqual(workspace["productInstanceCount"], 1)
        open_stroke = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(open_stroke)
        draw.line((10, 40, 50, 40), fill=(255, 255, 255, 255), width=3)
        incomplete = object_workspace_from_user_mark(_png(open_stroke), target_size=(64, 64), close_px=3)
        self.assertFalse(incomplete["closedRing"])
        self.assertFalse(incomplete["fillsWholeCanvas"])
        self.assertLess(incomplete["workspacePixels"], 64 * 64 * 0.2)

    def test_scale_up_keeps_bottom_ground_contact(self) -> None:
        bbox = {"x": 40, "y": 40, "w": 20, "h": 16, "xMin": 40, "yMin": 40, "xMax": 59, "yMax": 55}
        placed = placement_bbox_from_workspace(
            bbox,
            op=INTENT_SCALE_UP,
            factor=JOKUM_DEFAULT_SCALE,
            canvas=(100, 80),
        )
        self.assertEqual(placed["yMax"], 55)
        self.assertGreater(placed["w"], bbox["w"])
        self.assertGreater(placed["h"], bbox["h"])
        self.assertEqual(placed["productInstanceCount"], 1)
        self.assertTrue(placed["bottomGroundContact"])
        moved = placement_bbox_from_workspace(
            bbox,
            op=INTENT_MOVE,
            factor=1.0,
            canvas=(100, 80),
            move_dx_ratio=0.08,
        )
        self.assertGreater(moved["xMin"], bbox["xMin"])
        self.assertEqual(moved["w"], bbox["w"])

    def test_sku_lineage_and_public_record_strip_bytes(self) -> None:
        sku = sku_id_from_generation_payloads(
            explanation={"productLockedLayer": {"status": "NOT_APPLICABLE"}},
            snapshot={"analysis": {"content_context_v1": {"sku_id": "82288271914"}}},
        )
        self.assertEqual(sku, "82288271914")
        public = public_authority_record({"status": PRODUCT_AUTHORITY_AVAILABLE, "bytes": b"secret", "skuId": sku})
        self.assertNotIn("bytes", public)
        self.assertTrue(public["productLockedLayerIsNotAuthority"])

    def test_authority_priority_persisted_content_center_tracked_unavailable(self) -> None:
        png = _png(Image.new("RGB", (32, 32), (180, 40, 40)))
        persisted = resolve_product_authority(
            db=MagicMock(),
            sku="82288271914",
            persisted={"status": PRODUCT_AUTHORITY_AVAILABLE, "sourcePath": "C:/tmp/product.png", "sourceMime": "image/png"},
            path_exists=lambda path: path.endswith("product.png"),
            read_file=lambda path: png,
        )
        self.assertEqual(persisted["status"], PRODUCT_AUTHORITY_AVAILABLE)
        self.assertEqual(persisted["sourceType"], SOURCE_PERSISTED)

        with mock.patch(
            "content_center_assets.primary_product_asset_reference",
            return_value={"product_image_path": "/data/content.png", "asset_id": "a1", "product_title": "pack"},
        ):
            content = resolve_product_authority(
                MagicMock(),
                "82288271914",
                persisted={},
                path_exists=lambda path: path == "/data/content.png",
                read_file=lambda path: png,
            )
        self.assertEqual(content["sourceType"], SOURCE_CONTENT_CENTER)

        tracked_row = MagicMock()
        tracked_row.image_url = "https://shopping-phinf.pstatic.net/main_8228827/82288271914.5.jpg"
        tracked_row.title = "packshot"
        tracked_row.product_url = "https://smartstore.naver.com/thesujata/products/4743750201"
        tracked_row.id = 450
        query = MagicMock()
        query.filter.return_value = query
        query.order_by.return_value = query
        query.limit.return_value = query
        query.one_or_none.return_value = tracked_row
        db = MagicMock()
        db.query.return_value = query
        with mock.patch("content_center_assets.primary_product_asset_reference", return_value={}):
            tracked = resolve_product_authority(
                db,
                "82288271914",
                persisted={},
                fetch_url=lambda url: {
                    "bytes": png,
                    "mime": "image/jpeg",
                    "url": url,
                    "width": 1000,
                    "height": 1000,
                    "sha256": "abc",
                    "size": len(png),
                },
                path_exists=lambda path: False,
            )
        self.assertEqual(tracked["status"], PRODUCT_AUTHORITY_AVAILABLE)
        self.assertEqual(tracked["sourceType"], SOURCE_TRACKED)
        self.assertEqual(tracked["sourceWidth"], 32)
        self.assertEqual(tracked["sourceHeight"], 32)

        missing = resolve_product_authority(MagicMock(), "", persisted={}, path_exists=lambda path: False)
        self.assertEqual(missing["status"], PRODUCT_AUTHORITY_UNAVAILABLE)
        self.assertEqual(missing["code"], PRODUCT_AUTHORITY_UNAVAILABLE_CODE)


if __name__ == "__main__":
    unittest.main()
