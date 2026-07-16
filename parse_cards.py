import json, re

data = json.load(open('our_cards_current.json', encoding='utf-8'))

def norm(s):
    return s.lower().strip() if s else ""

def extract_condition_and_body(desc):
    m = re.match(r'^\s*•\s*(?:Bedingung|Konter)\s*:\s*(.+?)\s*•\s*(.*)$', desc, re.DOTALL)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, desc

def parse_sentence_actions(text, confidence_notes, extra_flags):
    actions = []
    lower_t = norm(text)

    patterns = [
        (r'bewege(?:n)? dich(?: diesen zug)? um (?:bis zu )?(\d+) zusätzliche[sn]? feld(?:er)?(?: (diagonal|horizontal))?',
         lambda m: {"action": "move", "target": "self", "fields": int(m.group(1)), "optional": "bis zu" in m.group(0),
                    **({"direction": m.group(2)} if m.group(2) else {})}),
        (r'(?:du kannst dich|du und dein \w+ könn(?:en|t) euch|können sich) (?:diesen zug )?um (?:bis zu )?(\d+) zusätzliche[sn]? (?:horizontale[n]? )?feld(?:er)?(?: (diagonal|horizontal))? bewegen',
         lambda m: {"action": "move", "target": "self_and_companion" if "wolf" in lower_t else "self", "fields": int(m.group(1)),
                    **({"direction": m.group(2)} if m.group(2) else {})}),
        (r'bewege(?:n)? dich um (\d+) zusätzliche[sn]? feld(?:er)? (diagonal|horizontal)',
         lambda m: {"action": "move", "target": "self", "fields": int(m.group(1)), "direction": m.group(2)}),
        (r'bewege (\d+) (?:feindliche|gegnerische) figur um (\d+) feld',
         lambda m: {"action": "move_enemy_figure", "count": int(m.group(1)), "fields": int(m.group(2))}),
        (r'du kannst dich(?: diesen zug)? diagonal bewegen',
         lambda m: {"action": "grant_movement_mode", "target": "self", "mode": "diagonal"}),
        (r'du kannst dich(?: diesen zug)? durch wände bewegen',
         lambda m: {"action": "grant_movement_mode", "target": "self", "mode": "through_walls"}),
        (r'ziehe (\d+) karten?',
         lambda m: {"action": "draw_card", "target": "self", "count": int(m.group(1))}),
        (r'wirf (\d+|1) (?:beliebige )?(?:hand)?karten? ab',
         lambda m: {"action": "discard_card", "target": "self", "count": (int(m.group(1)) if m.group(1).isdigit() else m.group(1))}),
        (r'du kannst (\d+|1) (?:weitere|zusätzliche) karten? spielen',
         lambda m: {"action": "play_additional_card", "target": "self", "count": int(m.group(1)) if m.group(1).isdigit() else 1}),
        (r'setzt? (?:seinen|ihren|deinen) nächsten zug aus',
         lambda m: {"action": "skip_turn", "target": "enemy", "count": 1}),
        (r'setzen (?:ihre|seine) nächsten (\d+) züge aus',
         lambda m: {"action": "skip_turn", "target": "enemy", "count": int(m.group(1))}),
        (r'(?:kann(?:n)?|können) sich[^.]* nicht (?:mehr )?bewegen',
         lambda m: {"action": "prevent_movement", "target": "context", "duration": "this_turn"}),
        (r'können keine karten spielen',
         lambda m: {"action": "prevent_card_play", "target": "context"}),
        (r'wird sofort geschnappt|werden geschnappt',
         lambda m: {"action": "capture_figure", "target": "context"}),
        (r'können[^.]* nicht geschnappt werden|kann(?:n)? nicht geschnappt werden',
         lambda m: {"action": "prevent_capture", "target": "context"}),
        (r'zerstöre(?:n)? (?:alle )?wände?',
         lambda m: {"action": "destroy_wall", "target": "chosen_or_area"}),
        (r'zerstöre 1 wand',
         lambda m: {"action": "destroy_wall", "target": "chosen", "count": 1}),
        (r'verschiebe 1 wand|bewege 1 wand',
         lambda m: {"action": "move_wall", "count": 1}),
        (r'setze 1 wand',
         lambda m: {"action": "place_wall", "count": 1}),
        (r'teleportier(?:e|t)',
         lambda m: {"action": "teleport", "target": "context"}),
        (r'tausche (?:die|deine) position(?:en)? durch teleportation',
         lambda m: {"action": "teleport_swap", "target": "context"}),
        (r'negiere den effekt',
         lambda m: {"action": "negate_effect", "target": "triggering_card"}),
        (r'lege (?:die|sie) karte auf den ablagestapel',
         lambda m: {"action": "discard_to_pile", "target": "triggering_card"}),
        (r'kann nicht gekontert werden',
         lambda m: {"action": "__flag__", "flag": "cannot_be_countered"}),
        (r'können keine konterkarten mehr gespielt werden',
         lambda m: {"action": "__flag__", "flag": "blocks_further_counters_this_turn"}),
        (r'suche in deinem deck nach (?:bis zu )?(\d+)?\s*karte',
         lambda m: {"action": "search_deck", "count": int(m.group(1)) if m.group(1) else 1}),
        (r'lege die falle verdeckt auf ein freies feld',
         lambda m: {"action": "place_trap"}),
        (r'platziere .*(?:banner|wolke|rauchwolke)',
         lambda m: {"action": "place_area_object"}),
        (r'erstelle 1 schattenklon',
         lambda m: {"action": "create_shadow_clone", "count": 1}),
        (r'entferne (?:deine|alle) schattenklone',
         lambda m: {"action": "remove_shadow_clone"}),
        (r'bestimme neu, welche(?:s)? (?:deine[rn]? figuren?|die heldenfigur ist)',
         lambda m: {"action": "reassign_hero_figure"}),
        (r'aktiviert den wolfmodus|wolf-modus',
         lambda m: {"action": "toggle_wolf_mode"}),
        (r'beschwöre den begleiter',
         lambda m: {"action": "summon_companion"}),
        (r'wähle eines:',
         lambda m: {"action": "choose_one"}),
        (r'setze .*(?:figuren|wände) .* zurück|zurückgesetzt',
         lambda m: {"action": "reset_state"}),
        (r'wird um 90.{1,3} gedreht|rotiert',
         lambda m: {"action": "rotate_board"}),
        (r'wirf 1 münze',
         lambda m: {"action": "flip_coin"}),
        (r'spiele .* als kopie',
         lambda m: {"action": "copy_card"}),
        (r'tauscht diese handkarten aus|tauscht? .* handkarte',
         lambda m: {"action": "swap_hand_card"}),
    ]

    for pat, builder in patterns:
        for m in re.finditer(pat, lower_t):
            try:
                built = builder(m)
                if built.get("action") == "__flag__":
                    extra_flags[built["flag"]] = True
                else:
                    actions.append(built)
            except Exception as e:
                confidence_notes.append(f"pattern_error:{pat}:{e}")
    return actions

results = []
for c in data:
    if c['cardType'] == 'Held':
        continue

    notes = []
    desc = c['description'] or ""
    condition, body = extract_condition_and_body(desc)

    trigger = None
    if c.get('trigger'):
        trigger = {"event": "custom", "text_de": c['trigger']}
    elif condition:
        trigger = {"event": "custom", "text_de": condition}

    cost_actions = []
    extra_flags = {}
    if c.get('cost'):
        cost_actions = parse_sentence_actions(c['cost'], notes, extra_flags)
        if not cost_actions:
            notes.append("cost_text_unparsed")

    effects = parse_sentence_actions(body, notes, extra_flags)

    flags = {}
    if c.get('notCounterable'):
        flags['cannot_be_countered'] = True
    if c.get('notPlayableWithFlag'):
        flags['not_playable_with_flag'] = True
    if c.get('deckLimit'):
        flags['deck_limit'] = c['deckLimit']
    if c.get('trapDeckLimit'):
        flags['trap_deck_limit'] = c['trapDeckLimit']
    flags.update(extra_flags)

    confidence = "high" if effects else "low"
    if len(effects) == 0:
        notes.append("no_actions_extracted")

    results.append({
        "id": c['id'],
        "name": c['name'],
        "cardType": c['cardType'],
        "class": c['class'],
        "trigger": trigger,
        "condition": condition,
        "cost": cost_actions if cost_actions else None,
        "effects": effects,
        "flags": flags if flags else None,
        "parse_confidence": confidence,
        "parse_notes": notes if notes else None,
        "raw_description": desc,
    })

json.dump(results, open('cards_structured_draft.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

high = sum(1 for r in results if r['parse_confidence'] == 'high')
low = sum(1 for r in results if r['parse_confidence'] == 'low')
print(f"Total (ohne Helden): {len(results)}")
print(f"Hohe Konfidenz (mind. 1 Aktion erkannt): {high}")
print(f"Niedrige Konfidenz (manuell pruefen): {low}")
