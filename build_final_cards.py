import json

# ---------------------------------------------------------------------------
# Heldenkarten -- jede definiert eine einmalige Klassenfaehigkeit, komplett
# von Hand strukturiert statt aus generischen Bausteinen zusammengesetzt.
# ---------------------------------------------------------------------------
HEROES = [
    {
        "id": "001", "name": "Assassin", "cardType": "Held", "class": "Assassine",
        "trigger": {"event": "game_start_or_respawn"},
        "condition": None, "cost": None,
        "effects": [
            {"action": "create_shadow_clone", "target": "self", "position": "adjacent_to_figure_on_start_line", "count": 1},
            {"action": "reassign_hero_figure", "target": "self"},
        ],
        "flags": {
            "clone_can_be_moved": True,
            "clone_can_play_cards": True,
            "clone_cannot_carry_flag": True,
            "clone_cannot_capture": True,
            "on_clone_or_hero_captured": "remove_clone_from_game",
        },
        "parse_confidence": "manual", "parse_notes": None,
        "raw_description": "Zu Spielbeginn oder bei Wiedergeburt: Erstelle 1 Schattenklon angrenzend zu deiner Figur auf der Startlinie. Bestimme neu, welches die Heldenfigur ist. Zu bewegende Felder duerfen die Heldenfigur und auch der Klon fahren. Karten koennen auch vom Klon aus gespielt werden, jedoch kann er keine Flaggen tragen oder Gegner schnappen. Wird deine Heldenfigur oder der Klon geschnappt, entferne den Klon aus dem Spiel.",
    },
    {
        "id": "002", "name": "Ritter", "cardType": "Held", "class": "Ritter",
        "trigger": {"event": "game_start_or_respawn"},
        "condition": None, "cost": None,
        "effects": [
            {"action": "grant_extra_action", "target": "self", "uses": 1, "scope": "any_single_future_turn",
             "options": [
                {"action": "draw_card", "count": 1},
                {"action": "play_additional_card", "count": 1},
                {"action": "move", "fields": 1},
                {"action": "place_wall", "count": 1},
             ]},
        ],
        "flags": None,
        "parse_confidence": "manual", "parse_notes": None,
        "raw_description": "Zu Spielbeginn oder bei Wiedergeburt: Du kannst 1 Mal in einem beliebigen Spielzug eines der folgenden Aktionen zusaetzlich ausfuehren: 1 Karte ziehen / 1 Karte spielen / 1 Feld bewegen / 1 Wand setzen",
    },
    {
        "id": "003", "name": "Waldläufer", "cardType": "Held", "class": "Ranger",
        "trigger": {"event": "game_start_or_respawn"},
        "condition": None, "cost": None,
        "effects": [
            {"action": "grant_extra_action", "target": "self", "uses": 1, "scope": "any_single_future_turn",
             "options": [
                {"action": "search_deck", "count": 1, "then": "shuffle_deck"},
             ]},
        ],
        "flags": None,
        "parse_confidence": "manual", "parse_notes": None,
        "raw_description": "Ab Spielbeginn sowie nach Wiedergeburt: Du kannst 1 Mal in einem beliebigen Spielzug dein Deck nach 1 Karte durchsuchen und auf die Hand nehmen. Mische dein Deck anschliessend.",
    },
    {
        "id": "004", "name": "Zauberer", "cardType": "Held", "class": "Zauberer",
        "trigger": {"event": "game_start"},
        "condition": None, "cost": None,
        "effects": [
            {"action": "place_portal_pair", "target": "self", "constraint": "same_horizontal_line"},
        ],
        "flags": {"portals_usable_by": "self_and_allies"},
        "parse_confidence": "manual", "parse_notes": None,
        "raw_description": "Zu Spielbeginn: Platziere 2 Portale auf derselben horizontalen Linie. Betrittst du ein Portal, erscheinst du beim anderen. Die Portale koennen nur von dir und befreundete Spieler benutzt werden.",
    },
]

# ---------------------------------------------------------------------------
# Sonderfaelle -- Karten, die der generische Baustein-Parser nicht sicher
# uebersetzen konnte. Von Hand strukturiert.
# ---------------------------------------------------------------------------
SPECIAL_CASES = {
    "006": {  # Echobruch
        "trigger": {"event": "enemy_moves_extra_field", "params": {"min_fields": 1}},
        "condition": None, "cost": None,
        "effects": [{"action": "grant_bonus_movement", "target": "self", "fields": 2, "timing": "next_turn"}],
        "flags": None,
    },
    "009": {  # Schattenmanifest
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "set_flag", "flag": "clone_can_capture", "scope": "this_turn"}],
        "flags": None,
    },
    "010": {  # Schattenreflexe
        "trigger": None, "condition": None,
        "cost": [{"action": "discard_card", "target": "self", "count": "any", "id": "discarded"}],
        "effects": [{"action": "move", "target": "self", "fields": "1 + count(discarded)"}],
        "flags": None,
    },
    "016": {  # Spiegeltausch
        "trigger": {"event": "own_figure_targeted_by_enemy_effect"},
        "condition": None, "cost": None,
        "effects": [
            {"action": "teleport_swap", "target": "affected_figure", "with": "chosen_ally_in_radius", "radius": 3},
            {"action": "redirect_effect", "new_target": "swapped_ally"},
        ],
        "flags": None,
    },
    "021": {  # Schattenverzehr
        "trigger": None, "condition": None, "cost": None,
        "effects": [
            {"action": "remove_shadow_clone", "count": "all", "id": "removed_clones"},
            {"action": "move", "target": "self", "fields": "1 + count(removed_clones)"},
        ],
        "flags": None,
    },
    "022": {  # Ätherdeflektion (ersetzt riftklingen-resonanz)
        "trigger": {"event": "own_figure_targeted_by_enemy_effect"},
        "condition": None, "cost": None,
        "effects": [{"action": "redirect_effect", "new_target": "chosen_any_figure"}],
        "flags": None,
    },
    "024": {  # Eisenruf
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "prevent_card_play", "target": "enemies_in_radius", "radius": 2, "duration": "next_turn"}],
        "flags": None,
    },
    "025": {  # Entwaffnungsgriff
        "trigger": None, "condition": None, "cost": None,
        "effects": [
            {"action": "reveal_hand_cards", "target": "enemy", "count": 2, "id": "revealed"},
            {"action": "choose_card", "from": "revealed_plus_one_facedown", "filter": {"exclude_type": "Ultimate"}, "id": "chosen"},
            {"action": "force_discard", "target": "enemy", "card": "chosen"},
        ],
        "flags": None,
    },
    "028": {  # Herausforderung (ersetzt flüstergift)
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "forced_move", "target": "chosen_enemy_figure", "fields": 2, "direction": "away_from_caster_figure", "straight": True}],
        "flags": None,
    },
    "035": {  # Schildmodus
        "trigger": None, "condition": None, "cost": None,
        "effects": [
            {"action": "set_movement_cap", "target": "self_all_figures", "max_fields": 2, "scope": "this_turn"},
            {"action": "prevent_capture", "target": "self_all_figures", "duration": "until_next_turn_start"},
        ],
        "flags": None,
    },
    "037": {  # Klang des singenden Schwertes
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "play_additional_card", "target": "self", "count": 2}],
        "flags": None,
    },
    "054": {  # Eilsamensaat
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "grant_bonus_movement", "target": "figures_adjacent_to_own_hero", "fields": 2, "timing": "next_turn"}],
        "flags": {"no_clone_stacking": True},
    },
    "065": {  # Winziger Eilsamen
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "move", "target": "self", "fields": 1}],
        "flags": None,
    },
    "068": {  # Doppelschuss (Waehle eines)
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "choose_one", "options": [
            [{"action": "play_additional_card", "target": "self", "count": 2}],
            [{"action": "draw_card", "target": "self", "count": 2}],
        ]}],
        "flags": None,
    },
    "069": {  # Eilsamen (Waehle eines)
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "choose_one", "options": [
            [{"action": "move", "target": "self_hero_or_companion", "fields": 1}],
            [{"action": "grant_bonus_movement", "target": "chosen_ally_figure", "fields": 1, "timing": "next_turn"}],
        ]}],
        "flags": None,
    },
    "075": {  # Fass!
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "move", "target": "self_and_companion", "fields": 1}],
        "flags": None,
    },
    "078": {  # Fesselsprung
        "trigger": {"event": "own_figure_targeted_by_enemy_effect",
                    "filter": {"effect_type": ["prevent_movement", "skip_turn"]}},
        "condition": None, "cost": None,
        "effects": [{"action": "negate_effect", "target": "self_figure_only"}],
        "flags": None,
    },
    "079": {  # Gleitschritt
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "move", "target": "self_and_companion", "fields": 1, "direction": "diagonal"}],
        "flags": None,
    },
    "085": {  # Waldsegen (Waehle eines)
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "choose_one", "options": [
            [{"action": "move", "target": "self", "fields": 2, "direction": "horizontal"}],
            [{"action": "grant_bonus_movement", "target": "chosen_ally_hero", "fields": 2, "direction": "horizontal", "timing": "next_turn"}],
        ]}],
        "flags": None,
    },
    "095": {  # Blitzstoss
        "trigger": {"event": "enemy_enters_line_of_sight"},
        "condition": None, "cost": None,
        "effects": [{"action": "move_enemy_figure", "target": "triggering_figure", "fields": 1, "direction": "any"}],
        "flags": None,
    },
    "096": {  # Dimensionstor
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "reposition_portals", "target": "self", "constraint": "horizontal_alignment"}],
        "flags": None,
    },
    "099": {  # Finsterniswende
        "trigger": None, "condition": None, "cost": None,
        "effects": [
            {"action": "rotate_board", "degrees": 90, "direction": "chosen_clockwise_or_counterclockwise"},
            {"action": "end_turn_immediately"},
        ],
        "flags": None,
        "notes": "Figuren/Portale/Gelaende/Missionsobjekte behalten ihre Koordinaten; nur die Bewegungsachsen des Feldes rotieren.",
    },
    "103": {  # Spiegeltransposition
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "move_figure_and_wall_together", "fields": 1, "direction": "chosen_straight"}],
        "flags": None,
    },
    "107": {  # Flaggenwechsel
        "trigger": None, "condition": None, "cost": None,
        "effects": [{"action": "transfer_flag", "target": "chosen_adjacent_ally_in_los", "mode": "take_or_give"}],
        "flags": None,
    },
    "073": {  # Falle: Rabenfalle -- choose_one Zweige ergaenzt (ueberschreibt Auto-Draft)
        "trigger": {"event": "enemy_figure_enters_trap_field"},
        "condition": None, "cost": None,
        "effects": [
            {"action": "place_trap", "id": "this_trap"},
            {"action": "choose_one", "options": [
                [{"action": "reveal_hand_cards", "target": "trap_owner_enemy"}],
                [{"action": "peek_deck_top", "target": "trap_owner_enemy", "count": 5, "then": "return_in_same_order"}],
            ]},
            {"action": "destroy_trap", "target": "this_trap"},
        ],
        "flags": {"deck_limit": 1, "trap_deck_limit": 5},
    },
    "059": {  # Schleierphiole -- rein reaktive Karte, keine aktive Wirkung ausser den Flags
        "trigger": None, "condition": None, "cost": None,
        "effects": [],
        "flags": {"cannot_be_countered": True, "blocks_further_counters_this_turn": True},
    },
}

# ---------------------------------------------------------------------------
# Zusammenfuehren
# ---------------------------------------------------------------------------
draft = json.load(open("cards_structured_draft.json", encoding="utf-8"))
our_cards = json.load(open("our_cards_current.json", encoding="utf-8"))
our_by_id = {c["id"]: c for c in our_cards}

final = []

# Heldenkarten voranstellen
final.extend(HEROES)

for entry in draft:
    cid = entry["id"]
    if cid in SPECIAL_CASES:
        override = SPECIAL_CASES[cid]
        entry["trigger"] = override["trigger"] if override["trigger"] is not None else entry["trigger"]
        entry["condition"] = override["condition"]
        entry["cost"] = override["cost"]
        entry["effects"] = override["effects"]
        merged_flags = entry.get("flags") or {}
        if override.get("flags"):
            merged_flags.update(override["flags"])
        entry["flags"] = merged_flags if merged_flags else None
        entry["parse_confidence"] = "manual"
        entry["parse_notes"] = None
        if "notes" in override:
            entry["notes"] = override["notes"]
    final.append(entry)

# Sortieren nach ID
final.sort(key=lambda e: e["id"])

json.dump(final, open("cards_structured_final.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

total = len(final)
manual = sum(1 for e in final if e["parse_confidence"] == "manual")
high = sum(1 for e in final if e["parse_confidence"] == "high")
low = sum(1 for e in final if e["parse_confidence"] == "low")
print(f"Gesamt: {total}")
print(f"Manuell strukturiert: {manual}")
print(f"Automatisch (hohe Konfidenz): {high}")
print(f"Noch offen (niedrige Konfidenz): {low}")
