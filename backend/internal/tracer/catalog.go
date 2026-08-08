// Package tracer holds the server-authoritative tracer-round cosmetics catalog.
//
// The catalog is the single source of truth for prices and visual parameters:
// the client never sends a price, it only names an item id. Visual parameters
// ship to the client so the renderer can build the matching effect, and the
// catalog carries a version so it can take part in config negotiation
// (requirements 4: 配置/武器/地图/协议全部版本化).
//
// Scope note: these are direct purchases with in-game credits earned from
// matches, tasks and check-ins. Requirements 2 excludes 皮肤交易/开箱/博彩 from
// the first release, so this package intentionally has no trading, no random
// crates and no real-money path.
package tracer

// CatalogVersion changes whenever an item is added, repriced or retuned.
const CatalogVersion = 1

// Style selects which renderer implementation draws the tracer.
type Style string

const (
	// StyleWhip is the cheapest style: the beam appears instantly and its tail
	// retracts toward the impact point. Used as the low-quality fallback.
	StyleWhip Style = "whip"
	// StyleTraveling moves a fixed-length streak at bullet speed.
	StyleTraveling Style = "traveling"
	// StyleShader keeps geometry static and drives the head and falloff from a
	// fragment shader.
	StyleShader Style = "shader"
)

// Visual carries every parameter the client renderer needs. Keeping these on
// the server means a retune ships without a client release.
type Visual struct {
	Style Style `json:"style"`
	// CoreColor is the bright inner colour, CoreGlow the outer halo. Hex RGB.
	CoreColor string `json:"coreColor"`
	GlowColor string `json:"glowColor"`
	// RadiusM is the beam radius in metres.
	RadiusM float64 `json:"radiusM"`
	// SpeedMps only applies to travelling and shader styles.
	SpeedMps float64 `json:"speedMps"`
	// TrailM is the visible trail length in metres.
	TrailM float64 `json:"trailM"`
	// LifetimeMs is the fixed lifetime for whip, or the post-impact fade for
	// the travelling styles.
	LifetimeMs int `json:"lifetimeMs"`
}

// Item is one purchasable tracer round.
type Item struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Rarity string `json:"rarity"`
	Price  int32  `json:"price"`
	// Default items are owned by every account and cannot be purchased.
	Default bool   `json:"default"`
	Visual  Visual `json:"visual"`
}

// DefaultItemID is granted to every account and is the fallback when a player
// has nothing equipped.
const DefaultItemID = "standard"

var catalog = []Item{
	{
		ID: DefaultItemID, Name: "制式曳光", Rarity: "common", Price: 0, Default: true,
		Visual: Visual{
			Style: StyleWhip, CoreColor: "#ffe08a", GlowColor: "#ffb347",
			RadiusM: 0.014, SpeedMps: 900, TrailM: 12, LifetimeMs: 110,
		},
	},
	{
		ID: "copper", Name: "赤铜", Rarity: "common", Price: 1200,
		Visual: Visual{
			Style: StyleTraveling, CoreColor: "#ffd27a", GlowColor: "#e8701f",
			RadiusM: 0.016, SpeedMps: 900, TrailM: 14, LifetimeMs: 40,
		},
	},
	{
		ID: "glacier", Name: "冰川", Rarity: "rare", Price: 3600,
		Visual: Visual{
			Style: StyleTraveling, CoreColor: "#eaf9ff", GlowColor: "#4fb8ff",
			RadiusM: 0.018, SpeedMps: 1050, TrailM: 18, LifetimeMs: 50,
		},
	},
	{
		ID: "ember", Name: "余烬", Rarity: "rare", Price: 3600,
		Visual: Visual{
			Style: StyleShader, CoreColor: "#fff6d8", GlowColor: "#ff5a1f",
			RadiusM: 0.020, SpeedMps: 880, TrailM: 16, LifetimeMs: 90,
		},
	},
	{
		ID: "voltage", Name: "高压", Rarity: "epic", Price: 7500,
		Visual: Visual{
			Style: StyleShader, CoreColor: "#f2fbff", GlowColor: "#7a5cff",
			RadiusM: 0.022, SpeedMps: 1200, TrailM: 22, LifetimeMs: 100,
		},
	},
	{
		ID: "verdant", Name: "苍翠", Rarity: "epic", Price: 7500,
		Visual: Visual{
			Style: StyleShader, CoreColor: "#f4fff0", GlowColor: "#3ddc84",
			RadiusM: 0.020, SpeedMps: 960, TrailM: 20, LifetimeMs: 95,
		},
	},
	{
		ID: "obsidian", Name: "曜蚀", Rarity: "legendary", Price: 14000,
		Visual: Visual{
			Style: StyleShader, CoreColor: "#ffffff", GlowColor: "#ff2d6f",
			RadiusM: 0.026, SpeedMps: 1300, TrailM: 26, LifetimeMs: 120,
		},
	},
}

// Catalog returns a copy of every item, cheapest first, default item leading.
func Catalog() []Item {
	out := make([]Item, len(catalog))
	copy(out, catalog)
	return out
}

// Lookup resolves an item id. The second result is false for unknown ids, so
// callers can reject client-supplied ids without trusting them.
func Lookup(id string) (Item, bool) {
	for _, item := range catalog {
		if item.ID == id {
			return item, true
		}
	}
	return Item{}, false
}

// DefaultOwned lists the item ids every account owns for free.
func DefaultOwned() []string {
	var out []string
	for _, item := range catalog {
		if item.Default {
			out = append(out, item.ID)
		}
	}
	return out
}
