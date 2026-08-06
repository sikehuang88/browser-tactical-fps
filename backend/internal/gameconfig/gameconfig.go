// Package gameconfig 提供版本化的游戏配置下发（武器数值、协议版本、规则）。
// 配置版本随发布推进；对局开始后不得热更当前对局核心规则（需求文档 19 章）。
package gameconfig

type Weapon struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Category    string `json:"category"`
	Damage      int    `json:"damage"`
	FireRatePM  int    `json:"fireRatePerMin"`
	Automatic   bool   `json:"automatic"`
}

type Config struct {
	Version         string   `json:"version"`
	ProtocolVersion int      `json:"protocolVersion"`
	MapIDs          []int    `json:"mapIds"`
	Weapons         []Weapon `json:"weapons"`
}

func Default() *Config {
	return &Config{
		Version:         "2026.08.0",
		ProtocolVersion: 1,
		MapIDs:          []int{1, 2},
		Weapons: []Weapon{
			{ID: 1, Name: "strike_r1", DisplayName: "步枪 R1", Category: "rifle", Damage: 32, FireRatePM: 600, Automatic: true},
			{ID: 2, Name: "pistol_p9", DisplayName: "手枪 P9", Category: "pistol", Damage: 26, FireRatePM: 420, Automatic: false},
			{ID: 3, Name: "smg_s4", DisplayName: "冲锋枪 S4", Category: "smg", Damage: 20, FireRatePM: 800, Automatic: true},
			{ID: 4, Name: "sniper_m1", DisplayName: "狙击枪 M1", Category: "sniper", Damage: 110, FireRatePM: 40, Automatic: false},
		},
	}
}
