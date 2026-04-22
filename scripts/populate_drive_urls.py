"""
drive_url紐付けスクリプト
Monday.comから取得した360件は反映済み。
残りのアイテム（2604シリーズ等）はGoogle DriveのフォルダURLを手動で設定するか、
Edge Function改修後に自動検索する。

使い方:
  python3 populate_drive_urls.py

現状:
  - Monday.comデータから360件のdrive_urlを反映済み
  - 2604シリーズ（Slack Bot時代）はDriveにフォルダがある可能性あり
  - Webアプリ時代（2604-0166以降）はEdge Function経由でアップロード時に自動設定される
"""

import json
import urllib.request
import urllib.parse

SUPABASE_URL = "https://peportftucwuxfnmaanr.supabase.co"
KEY = "sb_publishable_ndRcO6c962YBhShB3gP3MA_kHRmaofQ"

def get_items_without_drive_url():
    """drive_urlが空のYYMM-NNNN形式アイテムを取得"""
    items = []
    for offset in range(0, 1000, 500):
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/items?select=mgmt_num,product_name&drive_url=eq.&mgmt_num=like.*-*&offset={offset}&limit=500",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"}
        )
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read())
        if not data:
            break
        items.extend(data)
    return items

def update_drive_url(mgmt_num, url):
    """drive_urlを更新"""
    body = json.dumps({"drive_url": url}).encode()
    mn_encoded = urllib.parse.quote(mgmt_num, safe="")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/items?mgmt_num=eq.{mn_encoded}",
        data=body,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH"
    )
    urllib.request.urlopen(req)

if __name__ == "__main__":
    items = get_items_without_drive_url()
    print(f"YYMM-NNNN形式でdrive_urlが空のアイテム: {len(items)}件")
    for i in items[:10]:
        print(f"  {i['mgmt_num']} | {i['product_name'][:30]}")
    if len(items) > 10:
        print(f"  ... 他{len(items)-10}件")

    print("\n※ これらのアイテムのdrive_urlは以下の方法で設定できます:")
    print("  1. Google Driveで該当フォルダのURLを確認して手動設定")
    print("  2. Edge Function改修でフォルダ検索APIを追加")
    print("  3. 新規撮影時にEdge Functionが自動でdrive_urlを設定")
