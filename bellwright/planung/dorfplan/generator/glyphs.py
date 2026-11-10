# Pictogram library: each glyph is drawn around (0,0) = bottom centre, about 48 px wide.
INK = "#3a2a1a"
WALL = "#efdcae"
ROOF = "#b0503a"
ROOF2 = "#8a4b2c"
THATCH = "#d2a94e"
WOOD = "#8a6037"
WOODL = "#b98a55"
DARK = "#5a3d24"

def sw(w=2):
    return f'stroke="{INK}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"'

G = {}

G["house"] = f'''
<path d="M-15,0 V-18 H15 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-19,-16 L0,-34 L19,-16 Z" fill="{ROOF}" {sw()}/>
<path d="M-12,-21 L0,-31 M12,-21 L3,-28" stroke="#7d3424" stroke-width="1.3" fill="none"/>
<rect x="-4" y="-10" width="8" height="10" fill="{DARK}" {sw(1.5)}/>
<rect x="6" y="-14" width="6" height="5" fill="#f8e7a8" {sw(1.2)}/>
<rect x="-12" y="-14" width="5" height="5" fill="#f8e7a8" {sw(1.2)}/>
'''

G["tent"] = f'''
<path d="M-18,0 L0,-31 L18,0 Z" fill="#ead7a4" {sw()}/>
<path d="M0,-31 L-7,0 M0,-31 L7,0" stroke="#a88a5a" stroke-width="1.3" fill="none"/>
<path d="M-5,0 L0,-13 L5,0 Z" fill="{DARK}" {sw(1.4)}/>
<path d="M0,-31 V-38" {sw(1.8)} fill="none"/>
<path d="M0,-38 L8,-35.5 L0,-33 Z" fill="#c0442e" {sw(1)}/>
'''

G["rathaus"] = f'''
<path d="M-28,0 V-22 H28 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-32,-20 L-22,-36 H22 L32,-20 Z" fill="{ROOF2}" {sw()}/>
<path d="M-7,-30 V-50 H7 V-30 Z" fill="{WALL}" {sw()}/>
<path d="M-10,-48 L0,-60 L10,-48 Z" fill="{ROOF}" {sw()}/>
<path d="M0,-60 V-70" {sw(1.8)} fill="none"/>
<path d="M0,-70 L12,-66.5 L0,-63 Z" fill="#d9a441" {sw(1)}/>
<path d="M-6,0 V-9 A6,6 0 0 1 6,-9 V0 Z" fill="{DARK}" {sw(1.5)}/>
<rect x="-22" y="-16" width="7" height="7" fill="#f8e7a8" {sw(1.2)}/>
<rect x="15" y="-16" width="7" height="7" fill="#f8e7a8" {sw(1.2)}/>
<circle cx="0" cy="-41" r="3.2" fill="#f8e7a8" {sw(1.2)}/>
'''

# research table with open book (drawn small, beside the town hall)
G["table_book"] = f'''
<path d="M-12,-10 H12" {sw(2.4)} fill="none"/>
<path d="M-9,-10 V0 M9,-10 V0" {sw(1.8)} fill="none"/>
<path d="M-9,-11 Q-4.5,-15 0,-12 Q4.5,-15 9,-11 L9,-13.5 Q4.5,-17.5 0,-14.5 Q-4.5,-17.5 -9,-13.5 Z" fill="#fbf2d6" {sw(1.2)}/>
<path d="M0,-12 V-14.5" {sw(1)}/>
'''

G["fire_pot"] = f'''
<path d="M-11,0 L11,-5 M-11,-5 L11,0" stroke="{WOOD}" stroke-width="3.6" stroke-linecap="round"/>
<path d="M-6,-3 C-8,-9 -3,-10 -2,-15 C1,-11 5,-9 6,-3 Z" fill="#e8742a" {sw(1.3)}/>
<path d="M-2.5,-3 C-3.5,-6 -1,-8 0,-10 C1.5,-8 3,-6 2.5,-3 Z" fill="#f6c94a"/>
<path d="M-15,1 V-28 M15,1 V-28" {sw(2.4)} fill="none"/>
<path d="M-18,-31 L-15,-27 L-12,-31 M12,-31 L15,-27 L18,-31" {sw(1.6)} fill="none"/>
<path d="M-17,-27 H17" stroke="{WOOD}" stroke-width="3" stroke-linecap="round"/>
<path d="M-17,-27 H17" stroke="{INK}" stroke-width=".9" opacity=".6"/>
<path d="M0,-27 V-23" {sw(1.2)}/>
<path d="M-9,-23 H9 C9,-12 -9,-12 -9,-23 Z" fill="#2f2a26" {sw(1.4)}/>
<path d="M-10,-23 H10" {sw(2)}/>
<path d="M-3,-26 c-2,-3 2,-4 0,-7 M3,-26 c-2,-3 2,-4 0,-7" stroke="#9a948c" stroke-width="1.4" fill="none" opacity=".8"/>
'''

G["barrels"] = f'''
<path d="M-18,0 C-21,-8 -21,-16 -18,-22 H-4 C-1,-16 -1,-8 -4,0 Z" fill="{WOODL}" {sw()}/>
<path d="M-19.5,-7 H-2.5 M-19.5,-15 H-2.5" stroke="{INK}" stroke-width="1.4"/>
<path d="M2,0 C-1,-7 -1,-13 2,-19 H14 C17,-13 17,-7 14,0 Z" fill="{WOODL}" {sw()}/>
<path d="M0.5,-6 H15.5 M0.5,-13 H15.5" stroke="{INK}" stroke-width="1.4"/>
<path d="M12,0 C10,-6 13,-12 18,-12 C23,-12 25,-6 23,0 Z" fill="#e2cf9a" {sw(1.6)}/>
<path d="M16,-12 L18,-15 L20,-12" {sw(1.2)} fill="none"/>
'''

G["crates"] = f'''
<rect x="-20" y="-16" width="18" height="16" fill="{WOODL}" {sw()}/>
<path d="M-20,-16 L-2,0 M-20,0 L-2,-16" stroke="{INK}" stroke-width="1.2"/>
<rect x="0" y="-16" width="18" height="16" fill="{WOODL}" {sw()}/>
<path d="M0,-16 L18,0 M0,0 L18,-16" stroke="{INK}" stroke-width="1.2"/>
<rect x="-10" y="-32" width="18" height="16" fill="#c99c62" {sw()}/>
<path d="M-10,-32 L8,-16 M-10,-16 L8,-32" stroke="{INK}" stroke-width="1.2"/>
'''

G["well"] = f'''
<path d="M-12,0 V-12 H12 V0 Z" fill="#c8bba2" {sw()}/>
<path d="M-12,-6 H12 M-4,-12 V-6 M5,-6 V0 M-7,-6 V0" stroke="{INK}" stroke-width="1.1"/>
<ellipse cx="0" cy="-12" rx="12" ry="3.5" fill="#6f9fb8" {sw(1.6)}/>
<path d="M-10,-12 V-30 M10,-12 V-30" {sw(2)} fill="none"/>
<path d="M-16,-27 L0,-38 L16,-27 Z" fill="{ROOF}" {sw()}/>
<path d="M0,-27 V-17" {sw(1)}/>
<rect x="-3" y="-19" width="6" height="5" fill="{WOOD}" {sw(1)}/>
'''

G["latrine"] = f'''
<path d="M-9,0 V-24 H9 V0 Z" fill="{WOODL}" {sw()}/>
<path d="M-12,-23 L0,-31 L12,-23 Z" fill="{ROOF2}" {sw()}/>
<path d="M-5,0 V-18 H5 V0" fill="#a77a48" {sw(1.3)}/>
<path d="M1.5,-15 A3,3 0 1 1 1.5,-10 A2.2,2.2 0 1 0 1.5,-15 Z" fill="#f6e6b0" stroke="{INK}" stroke-width=".8"/>
'''

G["thresh"] = f'''
<path d="M-20,0 V-20 H14 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-24,-18 L-3,-36 L18,-18 Z" fill="{THATCH}" {sw()}/>
<path d="M-18,-21 L-3,-33 M-10,-19 L-1,-27" stroke="#9a7a32" stroke-width="1.2"/>
<rect x="-12" y="-13" width="12" height="13" fill="{DARK}" {sw(1.4)}/>
<path d="M20,0 L16,-22 M20,0 L20,-24 M20,0 L24,-22 M20,0 L13,-19 M20,0 L27,-19" stroke="#b08a2a" stroke-width="2" stroke-linecap="round"/>
<path d="M14,-10 H26" {sw(1.6)}/>
<path d="M16,-22 l-1.5,-4 M20,-24 v-4.5 M24,-22 l1.5,-4" stroke="#d9b54a" stroke-width="3" stroke-linecap="round"/>
'''

G["barn"] = f'''
<path d="M-22,0 V-20 H22 V0 Z" fill="#a84b33" {sw()}/>
<path d="M-26,-18 L-14,-34 H14 L26,-18 Z" fill="{DARK}" {sw()}/>
<path d="M-9,0 V-15 H9 V0" fill="#d9b98a" {sw(1.5)}/>
<path d="M-9,-15 L9,0 M-9,0 L9,-15 M0,-15 V0" stroke="{INK}" stroke-width="1.2"/>
<path d="M-18,-6 H-12 M12,-6 H18 M-18,-12 H-12 M12,-12 H18" stroke="#6f2e1e" stroke-width="1.1"/>
<path d="M-3,-27 h6 v4 h-6 z" fill="#f8e7a8" {sw(1)}/>
'''

G["compost"] = f'''
<path d="M-18,0 V-12 H18 V0 Z" fill="{WOODL}" {sw()}/>
<path d="M-18,-6 H18 M-6,-12 V0 M6,-12 V0" stroke="{INK}" stroke-width="1.1"/>
<path d="M-16,-12 C-14,-22 -6,-24 -1,-21 C4,-26 13,-22 16,-12 Z" fill="#6b4a2a" {sw(1.6)}/>
<path d="M-8,-18 l3,-4 l2,4 M5,-17 l2,-5 l2,5 M-1,-21 l1,-3" stroke="#6f9a3a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
'''

G["farm"] = f'''
<path d="M-16,0 V-18 H14 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-20,-16 L-1,-34 L18,-16 Z" fill="{THATCH}" {sw()}/>
<path d="M-14,-19 L-1,-31 M-6,-18 L2,-26 M6,-19 L1,-24" stroke="#9a7a32" stroke-width="1.2"/>
<rect x="-6" y="-10" width="8" height="10" fill="{DARK}" {sw(1.4)}/>
<rect x="6" y="-13" width="5" height="5" fill="#f8e7a8" {sw(1.1)}/>
<path d="M16,0 V-9 M22,0 V-9 M28,0 V-9 M14,-6 H30 M14,-2.5 H30" stroke="{INK}" stroke-width="1.5"/>
<path d="M-30,0 C-30,-10 -26,-16 -22,-16 C-18,-16 -14,-10 -14,0 Z" fill="#e3bf5a" {sw(1.4)}/>
'''

G["sawpit"] = f'''
<circle cx="-14" cy="-6" r="6" fill="#d9b07a" {sw(1.5)}/>
<circle cx="-2" cy="-6" r="6" fill="#d9b07a" {sw(1.5)}/>
<circle cx="-8" cy="-16" r="6" fill="#d9b07a" {sw(1.5)}/>
<circle cx="-14" cy="-6" r="2" fill="none" stroke="{WOOD}" stroke-width="1"/>
<circle cx="-2" cy="-6" r="2" fill="none" stroke="{WOOD}" stroke-width="1"/>
<circle cx="-8" cy="-16" r="2" fill="none" stroke="{WOOD}" stroke-width="1"/>
<path d="M6,0 L18,-18 M18,0 L6,-18" {sw(2.2)} fill="none"/>
<path d="M2,-12 L24,-12" stroke="{WOOD}" stroke-width="5" stroke-linecap="round"/>
<path d="M2,-12 L24,-12" stroke="{INK}" stroke-width="1" fill="none" opacity=".6"/>
<path d="M12,-22 L20,-4" stroke="#9aa3a8" stroke-width="2.4"/>
<path d="M12,-22 L20,-4" stroke="{INK}" stroke-width=".8" stroke-dasharray="1.5 1.5"/>
'''

G["toolmaker"] = f'''
<path d="M-18,0 V-18 H16 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-22,-16 L-1,-32 L20,-16 Z" fill="{ROOF}" {sw()}/>
<rect x="-12" y="-11" width="8" height="11" fill="{DARK}" {sw(1.4)}/>
<path d="M1,-7 H13 L11,-3 H3 Z" fill="#7d8790" {sw(1.3)}/>
<path d="M5,-3 V0 M9,-3 V0" {sw(1.3)}/>
<path d="M18,-34 L28,-24" stroke="{WOOD}" stroke-width="3" stroke-linecap="round"/>
<path d="M13,-35 L20,-42 L25,-37 L18,-30 Z" fill="#8f99a2" {sw(1.4)}/>
'''

G["loom"] = f'''
<path d="M-16,0 V-30 M16,0 V-30" {sw(2.6)} fill="none"/>
<path d="M-19,-30 H19 M-16,-5 H16" {sw(2.4)} fill="none"/>
<path d="M-12,-30 V-10 M-8,-30 V-10 M-4,-30 V-10 M0,-30 V-10 M4,-30 V-10 M8,-30 V-10 M12,-30 V-10" stroke="#8a6a4a" stroke-width="1"/>
<path d="M-13,-18 H13 V-9 H-13 Z" fill="#c95a3c" {sw(1.3)}/>
<path d="M-13,-14 H13" stroke="#f0d08a" stroke-width="1.4"/>
<path d="M18,-12 H30 M20,-12 V0 M28,-12 V0" {sw(1.8)} fill="none"/>
<circle cx="24" cy="-15" r="3" fill="#f2e2b8" {sw(1)}/>
'''

G["bench"] = f'''
<path d="M-22,-14 H22" stroke="{WOOD}" stroke-width="5" stroke-linecap="round"/>
<path d="M-22,-14 H22" stroke="{INK}" stroke-width="1" opacity=".5"/>
<path d="M-18,-12 V0 M18,-12 V0 M-14,-12 V0 M14,-12 V0" {sw(2)} fill="none"/>
<path d="M-16,-17 L-6,-24" stroke="{WOOD}" stroke-width="2.4" stroke-linecap="round"/>
<path d="M-8,-27 L-3,-22 L-6,-19 L-11,-24 Z" fill="#8f99a2" {sw(1.1)}/>
<path d="M2,-17 L16,-17 L16,-21 L4,-24 Z" fill="#aab2b8" {sw(1.1)}/>
<path d="M16,-17 l4,0 l0,-4 l-4,0" fill="{WOOD}" {sw(1)}/>
'''

G["tub"] = f'''
<path d="M-15,-14 L-12,0 H12 L15,-14 Z" fill="{WOODL}" {sw()}/>
<path d="M-7,-14 L-6,0 M0,-14 V0 M7,-14 L6,0" stroke="{INK}" stroke-width="1.1"/>
<path d="M-14,-9 H14 M-13,-4 H13" stroke="{INK}" stroke-width="1.5"/>
<ellipse cx="0" cy="-14" rx="15" ry="4" fill="#9b8a6a" {sw(1.6)}/>
<path d="M4,-13 L14,-30" stroke="{WOOD}" stroke-width="3" stroke-linecap="round"/>
<path d="M4,-13 L14,-30" stroke="{INK}" stroke-width=".8" opacity=".6"/>
'''

G["coop"] = f'''
<path d="M-14,-6 V-22 H10 V-6 Z" fill="{WALL}" {sw()}/>
<path d="M-17,-20 L-2,-32 L13,-20 Z" fill="{ROOF}" {sw()}/>
<path d="M-12,-6 V0 M8,-6 V0" {sw(2)}/>
<path d="M-4,-12 V-6 H2 V-12 Z" fill="{DARK}" {sw(1)}/>
<path d="M2,-7 L14,0" stroke="{WOOD}" stroke-width="2.4"/>
<ellipse cx="20" cy="-4" rx="5" ry="4" fill="#fbf6ea" {sw(1.2)}/>
<circle cx="24" cy="-8" r="2.4" fill="#fbf6ea" {sw(1)}/>
<path d="M26,-8 l2,.8 l-2,.8" fill="#e0a030"/>
<path d="M23.5,-10.5 l.6,-1.8 l.8,1.8" fill="#c0392b"/>
'''

G["butcher"] = f'''
<path d="M-20,0 V-18 H8 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-24,-16 L-6,-31 L12,-16 Z" fill="{ROOF2}" {sw()}/>
<rect x="-14" y="-11" width="8" height="11" fill="{DARK}" {sw(1.4)}/>
<path d="M12,0 V-28 M28,0 V-28 M10,-28 H30" {sw(2.2)} fill="none"/>
<path d="M16,-28 V-24 M24,-28 V-24" {sw(1)}/>
<path d="M16,-24 C12,-22 12,-12 16,-10 C20,-12 20,-22 16,-24 Z" fill="#c8735a" {sw(1.2)}/>
<path d="M24,-24 C20,-22 20,-14 24,-12 C28,-14 28,-22 24,-24 Z" fill="#b5584a" {sw(1.2)}/>
'''

G["tanner"] = f'''
<path d="M-16,0 V-30 M16,0 V-30 M-18,-28 H18 M-18,-6 H18" {sw(2.4)} fill="none"/>
<path d="M-10,-24 C-4,-26 4,-26 10,-24 C12,-18 12,-14 10,-10 C4,-8 -4,-8 -10,-10 C-12,-14 -12,-18 -10,-24 Z" fill="#c9a06a" {sw(1.4)}/>
<path d="M-16,-26 L-10,-24 M16,-26 L10,-24 M-16,-8 L-10,-10 M16,-8 L10,-10 M-16,-17 L-11.5,-17 M16,-17 L11.5,-17" stroke="{INK}" stroke-width="1"/>
'''

G["smoke"] = f'''
<path d="M-15,0 L-4,-24 L7,0 M-2,0 L9,-24 L20,0" {sw(2)} fill="none"/>
<path d="M-6,-21 H11" {sw(2)}/>
<path d="M-2,-21 v9 M3,-21 v11 M8,-21 v8" stroke="#b5584a" stroke-width="3" stroke-linecap="round"/>
<path d="M-12,-27 c-4,-4 2,-7 -2,-11 M-4,-30 c-4,-4 2,-7 -2,-11" stroke="#8d8a86" stroke-width="2" fill="none" stroke-linecap="round" opacity=".85"/>
'''

G["fisher"] = f'''
<path d="M-18,0 V-16 H8 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-22,-14 L-5,-28 L12,-14 Z" fill="{ROOF2}" {sw()}/>
<rect x="-12" y="-10" width="7" height="10" fill="{DARK}" {sw(1.3)}/>
<path d="M11,0 V-20 M24,0 V-20 M9,-20 H26" {sw(1.8)} fill="none"/>
<path d="M12,-19 L23,-3 M23,-19 L12,-3 M12,-13 L23,-13 M17.5,-19 V-3" stroke="#6a5a4a" stroke-width="1" fill="none"/>
'''

G["boat"] = f'''
<path d="M-18,-6 H18 C15,1 10,3 0,3 C-10,3 -15,1 -18,-6 Z" fill="{WOOD}" {sw(1.6)}/>
<path d="M-15,-3 H15" stroke="{WOODL}" stroke-width="1.4"/>
<path d="M-5,-5 L-21,3 M5,-5 L21,3" stroke="#6a4a2a" stroke-width="2" stroke-linecap="round"/><path d="M-21,3 l-3,1.5 M21,3 l3,1.5" stroke="#6a4a2a" stroke-width="3.2" stroke-linecap="round"/>
'''

G["lumber"] = f'''
<path d="M-20,0 V-16 H6 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-24,-14 L-7,-29 L10,-14 Z" fill="{ROOF2}" {sw()}/>
<rect x="-14" y="-10" width="7" height="10" fill="{DARK}" {sw(1.3)}/>
<path d="M10,-4 H28 M10,-10 H28" stroke="{WOOD}" stroke-width="5.5" stroke-linecap="round"/>
<path d="M10,-4 H28 M10,-10 H28" stroke="{INK}" stroke-width="1" opacity=".5"/>
<circle cx="28" cy="-4" r="2.8" fill="#d9b07a" {sw(1)}/>
<circle cx="28" cy="-10" r="2.8" fill="#d9b07a" {sw(1)}/>
<path d="M14,-14 L22,-30" stroke="{WOOD}" stroke-width="2.4" stroke-linecap="round"/>
<path d="M18,-31 C22,-33 26,-31 26,-27 L21,-26 Z" fill="#8f99a2" {sw(1.1)}/>
'''

G["gatherer"] = f'''
<path d="M-18,0 V-16 H8 V0 Z" fill="{WALL}" {sw()}/>
<path d="M-22,-14 L-5,-28 L12,-14 Z" fill="{THATCH}" {sw()}/>
<rect x="-12" y="-10" width="7" height="10" fill="{DARK}" {sw(1.3)}/>
<path d="M12,-12 H28 L25,0 H15 Z" fill="#c99c62" {sw(1.5)}/>
<path d="M13,-8 H27 M14,-4 H26" stroke="{INK}" stroke-width=".9"/>
<path d="M12,-12 C12,-22 28,-22 28,-12" fill="none" {sw(1.4)}/>
<circle cx="16" cy="-13.5" r="2.2" fill="#b8322a"/><circle cx="20" cy="-14.5" r="2.2" fill="#7a2a6a"/><circle cx="24" cy="-13.5" r="2.2" fill="#b8322a"/>
'''

G["muster"] = f'''
<path d="M-14,0 V-40" {sw(2.2)} fill="none"/>
<path d="M-14,-40 H4 L0,-34 L4,-28 H-14 Z" fill="#b8322a" {sw(1.4)}/>
<path d="M-11,-36 h7" stroke="#d9a441" stroke-width="2"/>
<path d="M2,-6 H26 M2,-16 H26" {sw(2.2)} fill="none"/>
<path d="M6,0 V-26 M14,0 V-28 M22,0 V-26" stroke="{WOOD}" stroke-width="2"/>
<path d="M6,-26 l-2,4 h4 z M14,-28 l-2,4 h4 z M22,-26 l-2,4 h4 z" fill="#8f99a2" {sw(1)}/>
'''

G["cart"] = f'''
<path d="M-22,-10 H16 V-18 H-22 Z" fill="{WOODL}" {sw()}/>
<path d="M-20,-18 C-20,-34 14,-34 14,-18 Z" fill="#efe2bf" {sw()}/>
<path d="M-9,-18 C-9,-30 3,-30 3,-18" fill="none" stroke="#a88a5a" stroke-width="1.2"/>
<path d="M16,-12 L28,-8" {sw(2)}/>
<circle cx="-12" cy="-6" r="6.5" fill="#d9b07a" {sw(1.6)}/>
<circle cx="8" cy="-6" r="6.5" fill="#d9b07a" {sw(1.6)}/>
<path d="M-12,-12.5 V0.5 M-18.5,-6 H-5.5 M8,-12.5 V0.5 M1.5,-6 H14.5" stroke="{INK}" stroke-width="1"/>
'''

# tree glyphs (origin at trunk base)
TREE_A = f'''<path d="M0,0 V-7" stroke="{DARK}" stroke-width="3"/>
<path d="M-12,-10 C-17,-12 -15,-22 -9,-22 C-9,-30 3,-32 5,-25 C12,-27 16,-18 11,-13 C14,-7 6,-3 2,-6 C-2,-3 -10,-4 -12,-10 Z" fill="#7e9150" stroke="#3a3420" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M-7,-19 C-6,-24 -1,-26 2,-23" fill="none" stroke="#b3bf7c" stroke-width="2.4" stroke-linecap="round"/>'''
TREE_B = f'''<path d="M0,0 V-6" stroke="{DARK}" stroke-width="3"/>
<path d="M0,-34 L-8,-20 H-4 L-11,-8 H11 L4,-20 H8 Z" fill="#5f7a4a" stroke="#2f3420" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M-1,-27 L-4,-21" stroke="#9db27a" stroke-width="2" stroke-linecap="round"/>'''
TREE_C = f'''<path d="M0,0 V-6" stroke="{DARK}" stroke-width="3"/>
<path d="M-10,-8 C-15,-10 -14,-19 -8,-19 C-7,-26 5,-27 7,-20 C13,-20 14,-11 9,-8 C6,-4 -6,-4 -10,-8 Z" fill="#8f9c58" stroke="#3a3420" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M-5,-15 C-4,-19 0,-21 3,-19" fill="none" stroke="#c0c888" stroke-width="2.2" stroke-linecap="round"/>'''

# icon bounding boxes at scale 1, origin bottom-centre: (x0, y0, x1, y1)
BOX = {
 "house": (-19,-34,19,0), "tent": (-18,-38,18,0), "rathaus": (-32,-70,32,0), "table_book": (-12,-18,12,0),
 "fire_pot": (-18,-33,18,1), "barrels": (-21,-22,25,0), "crates": (-20,-32,18,0), "well": (-16,-38,16,0),
 "latrine": (-12,-31,12,0), "thresh": (-24,-36,27,0), "barn": (-26,-34,26,0), "compost": (-18,-26,18,0),
 "farm": (-30,-34,30,0), "sawpit": (-20,-24,24,0), "toolmaker": (-22,-42,28,0), "loom": (-19,-30,30,0),
 "bench": (-24,-27,24,0), "tub": (-15,-30,15,0), "coop": (-17,-32,28,0), "butcher": (-24,-31,30,0),
 "tanner": (-18,-30,18,0), "smoke": (-16,-41,20,0), "fisher": (-22,-28,26,0), "boat": (-25,-8,25,5),
 "lumber": (-24,-33,31,0), "gatherer": (-22,-28,28,0), "muster": (-15,-40,26,0), "cart": (-22,-32,28,1),
}
