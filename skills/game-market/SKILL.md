---
name: game-market
description: Query YY game trading marketplace listings by game and category; guides users to the website for actual buy/sell actions
triggers:
  - game trading
  - game account
  - account trading
  - buy account
  - sell account
  - boosting
  - coaching
  - game currency
  - game items
  - 游戏交易
  - 游戏账号
  - 账号买卖
  - 代练
  - 陪练
  - 游戏币
  - 道具
  - 买账号
  - 卖账号
  - 王者荣耀
  - 英雄联盟
  - 三角洲行动
  - 和平精英
  - 穿越火线
  - 无畏契约
  - 绝地求生
  - 崩坏
  - 原神
  - CSGO
  - YY交易
  - YY商城
  - YY游仓
  - yy游仓
  - 游仓
  - mall.yy.com
argument-hint: "[game name] [category]"
---

# Game Market Skill

Query YY game trading marketplace listings directly in chat.
Browse by game → category → listings → paginate.
When the user wants to actually buy or sell, confirm then open the browser.

**No login required.** The API uses a front-end signature (MD5-based) that is self-contained.

---

## When to Activate

Activate when the user:
- Runs `/game-market` manually
- Mentions game trading keywords: game account, buy/sell account, boosting, coaching, game currency, game items
- Mentions specific game names: 王者荣耀, 英雄联盟, 三角洲行动, 和平精英, 穿越火线, 无畏契约, 绝地求生, 崩坏, 原神, CSGO
- Mentions YY marketplace: YY交易, YY商城, mall.yy.com

---

## Workflow

### Step 1 — Intent Recognition

Extract from user input:
- **Game name** → `categoryId`
- **Sub-category** → `subCategoryId`

| Sub-category | subCategoryId |
|-------------|--------------|
| 账号 (Account) | 5 |
| 代练 (Boosting) | 1 |
| 陪练 (Coaching) | 2 |
| 道具 (Items) | 3 |
| 游戏币 (Currency) | 4 |

If intent is unclear (game mentioned but no category, or vice versa), go to Step 2.

### Step 2 — Category Selection (when intent is unclear)

Run this Python snippet to fetch and display categories:

```python
import hashlib, uuid, time, requests

APPID  = "market_app"
SECRET = "ixlOJVDwdOm5rGdudhEywwK6"
HDID   = "38e6a82f5f724517d6cbe82cde56e846690afcb0"
BASE   = "https://gamemarket.yy.com"

def sign(uri):
    nonce = str(uuid.uuid4())
    ts    = str(int(time.time() * 1000))
    raw   = f"appId={APPID}&nonce={nonce}&timestamp={ts}&uri={uri}&secret={SECRET}"
    sig   = hashlib.md5(raw.encode()).hexdigest()
    return {
        "accept": "application/json, text/plain, */*",
        "origin": "https://mall.yy.com",
        "referer": "https://mall.yy.com/",
        "user-agent": "Mozilla/5.0",
        "x-appid": APPID, "x-nonce": nonce, "x-timestamp": ts, "x-signature": sig,
    }

uri  = "/category/queryShowCategories"
resp = requests.get(BASE + uri, params={"sid": "", "hdid": HDID}, headers=sign(uri), timeout=15)
cats = resp.json()["data"]

for c in cats:
    subs = ", ".join(s["name"] for s in c.get("subCategories", []))
    print(f"  {c['id']:>2}. {c['name']}  ({subs})")
```

Present the list to the user and ask them to choose game and sub-category.

### Step 3 — Query Listings

Run this Python snippet with the resolved `category_id` and `sub_category_id`:

```python
import hashlib, uuid, time, requests

APPID  = "market_app"
SECRET = "ixlOJVDwdOm5rGdudhEywwK6"
HDID   = "38e6a82f5f724517d6cbe82cde56e846690afcb0"
BASE   = "https://gamemarket.yy.com"

def sign(uri):
    nonce = str(uuid.uuid4())
    ts    = str(int(time.time() * 1000))
    raw   = f"appId={APPID}&nonce={nonce}&timestamp={ts}&uri={uri}&secret={SECRET}"
    sig   = hashlib.md5(raw.encode()).hexdigest()
    return {
        "accept": "application/json, text/plain, */*",
        "origin": "https://mall.yy.com",
        "referer": "https://mall.yy.com/",
        "user-agent": "Mozilla/5.0",
        "x-appid": APPID, "x-nonce": nonce, "x-timestamp": ts, "x-signature": sig,
    }

# ---- Set these before running ----
category_id     = 5    # None = all games
sub_category_id = 5
page_num        = 1
# ----------------------------------

uri    = "/goods/v2/search"
params = {
    "pageNum": str(page_num), "pageSize": "20",
    "requestSource": "HOME", "withRegionServer": "true",
    "hdid": HDID, "subCategoryId": str(sub_category_id),
    "searchDistChannelGoods": "false",
}
if category_id is not None:
    params["categoryId"] = str(category_id)

resp   = requests.get(BASE + uri, params=params, headers=sign(uri), timeout=15)
result = resp.json()["data"]
goods  = result.get("goodsList", [])
total  = result.get("totalCount", 0)

print(f"Total: {total} listings  |  Page {page_num}\n")
for i, g in enumerate(goods, 1):
    price  = g["salePrice"] / 100
    name   = g["goodsName"].replace("\r\n", " ").replace("\n", " ")[:80]
    labels = "  ".join(lb["labelName"] for lb in g.get("goodsLabels", []))
    gid    = g["goodsId"]
    cat    = g.get("categoryName", "")
    sub    = g.get("subCategoryName", "")
    url    = f"https://mall.yy.com/?pageId=20000#/shop/detail/{gid}"
    print(f"[{i:02d}] ¥{price:.0f}  {cat} · {sub}")
    print(f"     {name}")
    if labels:
        print(f"     【{labels}】")
    print(f"     🔗 {url}\n")
```

### Step 4 — Follow-up Interaction

After displaying results, keep listening:

| User says | Action |
|-----------|--------|
| "next page" / "more" / "下一页" | Increment page_num, re-run Step 3 |
| "item N" / "open #3" / "第N条" | Open that item's detail URL in browser |
| "change game" / "换个游戏" | Back to Step 1 |
| "buy" / "purchase" / "想买" | → Buy/Sell flow |
| "sell" / "want to sell" / "想卖" | → Buy/Sell flow |

---

## Buy / Sell Flow

When the user expresses intent to buy or sell:

1. **Reply with confirmation prompt:**
   > To buy or sell, you'll need to use the YY marketplace website. Open it now?

2. **If user confirms, run:**

```bash
# Open YY marketplace homepage
open "https://mall.yy.com/?pageId=20000"
```

If the user was interested in a specific item, open its detail page instead:
```bash
open "https://mall.yy.com/?pageId=20000#/shop/detail/{goodsId}"
```

---

## Error Handling

| Situation | Response |
|-----------|----------|
| API request fails / timeout | "Query failed. Visit https://mall.yy.com/?pageId=20000 directly." |
| Game has no such sub-category | "This game doesn't have that category. Available: [list sub-categories]" |
| Empty goods list | "No listings found for this selection." |
| Ambiguous game name | List similar game names and ask user to confirm |

---

## Out of Scope

- Login / authentication (not needed for queries)
- Placing orders or payments (redirect to website instead)
- Price sorting / filtering (future iteration)
- Favorites / comparison

---

## Examples

```
User: show me 王者荣耀 accounts
→ Queries categoryId=5, subCategoryId=5, displays 20 listings

User: I want to look at boosting services
→ Game unclear → shows game list for selection

User: next page
→ Increments to page 2, same category

User: open item 3
→ Opens https://mall.yy.com/?pageId=20000#/shop/detail/{goodsId}

User: I want to buy this
→ "To buy, you'll need the YY website. Open it now?"
→ Confirmed → open "https://mall.yy.com/?pageId=20000#/shop/detail/{goodsId}"

User: I want to sell my account
→ "To sell, you'll need the YY website. Open it now?"
→ Confirmed → open "https://mall.yy.com/?pageId=20000"
```

---

## API Reference

| Field | Value |
|-------|-------|
| Base URL | `https://gamemarket.yy.com` |
| Categories endpoint | `GET /category/queryShowCategories?sid=&hdid={HDID}` |
| Listings endpoint | `GET /goods/v2/search` |
| Signature | `MD5("appId={APPID}&nonce={nonce}&timestamp={ts}&uri={uri}&secret={SECRET}")` |
| APPID | `market_app` |
| SECRET | `ixlOJVDwdOm5rGdudhEywwK6` |
| HDID | `38e6a82f5f724517d6cbe82cde56e846690afcb0` |
| Detail URL pattern | `https://mall.yy.com/?pageId=20000#/shop/detail/{goodsId}` |
| Buy/Sell URL | `https://mall.yy.com/?pageId=20000` |
