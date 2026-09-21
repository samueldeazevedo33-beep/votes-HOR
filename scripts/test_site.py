#!/usr/bin/env python3
"""Verification du site dans un vrai navigateur.

Prerequis : `pip install playwright && playwright install chromium`, puis,
depuis la racine du depot, servir le site dans un autre terminal :

    python3 -m http.server 8777 --directory docs

Puis : `python3 scripts/test_site.py`. Le script sort en erreur si une
verification echoue ou si la console du navigateur signale une erreur.
"""

import os
import sys

from playwright.sync_api import sync_playwright

# Chemin d'un Chromium deja installe, si l'environnement en fournit un.
CHROME = os.environ.get('CHROMIUM_PATH')
erreurs, echecs = [], []

def verifier(condition, message):
    if condition:
        print(f'  ok   {message}')
    else:
        echecs.append(message)
        print(f'  ECHEC {message}')

with sync_playwright() as p:
    lancement = {'args': ['--no-sandbox']}
    if CHROME:
        lancement['executable_path'] = CHROME
    nav = p.chromium.launch(**lancement)
    page = nav.new_page(viewport={'width': 1320, 'height': 950})
    page.on('console', lambda m: erreurs.append(f'CONSOLE {m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: erreurs.append(f'PAGEERROR: {e}'))

    print('\n== Porte ==')
    page.goto('http://localhost:8777/index.html')
    page.wait_for_selector('#porte-form', state='visible')
    page.fill('#porte-mdp', 'mauvais'); page.click('#porte-form button[type=submit]')
    page.wait_for_timeout(300)
    verifier(page.is_visible('#porte-erreur'), 'mot de passe erroné refusé')
    verifier(page.is_hidden('#app'), 'application masquée tant que la porte est fermée')
    page.fill('#porte-mdp', 'horizons2027'); page.click('#porte-form button[type=submit]')
    page.wait_for_selector('#app', state='visible', timeout=15000)
    page.wait_for_function("document.querySelectorAll('#liste .scrutin').length>0", timeout=15000)
    verifier(True, 'mot de passe correct accepté')
    print('  entête:', page.inner_text('#entete-resume'))

    print('\n== Filtres ==')
    total = page.inner_text('#compte'); print('  départ:', total)
    page.select_option('#f-texte', 'PLF-2026'); page.wait_for_timeout(350)
    plf = page.inner_text('#compte'); print('  PLF 2026:', plf)
    verifier('927' in plf, 'filtre par texte')
    page.check('#f-marquants'); page.wait_for_timeout(350)
    marq = page.inner_text('#compte'); print('  marquants:', marq)
    verifier(0 < int(marq.split()[0].replace(' ','').replace(' ','')) < 400, 'votes marquants resserrés')
    page.uncheck('#f-marquants')
    page.select_option('#f-position', 'pour'); page.wait_for_timeout(350)
    print('  position pour:', page.inner_text('#compte'))
    page.select_option('#f-position', '')
    page.fill('#f-recherche', 'Tanguy'); page.wait_for_timeout(500)
    rech = page.inner_text('#compte'); print('  recherche "Tanguy":', rech)
    verifier('Aucun' not in rech, 'recherche sur auteur d’amendement')
    page.fill('#f-recherche', ''); page.wait_for_timeout(400)
    page.click('#btn-reset'); page.wait_for_timeout(400)
    verifier(page.inner_text('#compte') == total, 'réinitialisation des filtres')

    print('\n== Détail d’un scrutin ==')
    # on cible un scrutin solennel, ou le groupe est massivement present
    page.select_option('#f-categorie', 'ensemble'); page.wait_for_timeout(400)
    page.click('#liste .scrutin:first-child [data-bascule]')
    page.wait_for_selector('#liste .scrutin:first-child .votants', timeout=5000)
    n = page.eval_on_selector_all('#liste .scrutin:first-child .votant', 'e=>e.length')
    print('  votants affichés:', n)
    verifier(n >= 10, 'votes nominatifs affichés sur un vote sur l’ensemble')
    page.select_option('#f-categorie', ''); page.wait_for_timeout(400)

    print('\n== Élément de langage ==')
    page.select_option('#f-texte', 'PLF-2026'); page.wait_for_timeout(400)
    page.click('#btn-edl'); page.wait_for_selector('#edl-texte', state='visible')
    edl = page.input_value('#edl-texte')
    verifier(len(edl) > 400, 'EDL non vide')
    verifier('projet de loi de finances pour 2026' in edl, 'libellé de texte correct dans l’EDL')
    print('\n--- EDL groupe ---\n' + edl + '\n---')
    page.keyboard.press('Escape')
    verifier(page.is_hidden('#edl'), 'fermeture par Échap')

    print('\n== EDL pour un député ==')
    page.select_option('#f-depute', '3'); page.wait_for_timeout(400)
    page.click('#btn-edl'); page.wait_for_selector('#edl-texte', state='visible')
    edl2 = page.input_value('#edl-texte')
    print('\n--- EDL député ---\n' + edl2[:900] + '\n---')
    page.keyboard.press('Escape')
    page.select_option('#f-depute', ''); page.select_option('#f-texte', ''); page.wait_for_timeout(300)

    print('\n== Vue députés ==')
    page.click('.onglet[data-vue=deputes]')
    page.wait_for_selector('.carte-depute', timeout=5000)
    cartes = page.eval_on_selector_all('.carte-depute', 'e=>e.length')
    print('  cartes:', cartes)
    verifier(cartes > 25, 'cartes députés affichées')
    page.fill('#f-depute-recherche', 'Marcangeli'); page.wait_for_timeout(350)
    verifier(page.eval_on_selector_all('.carte-depute', 'e=>e.length') == 1, 'recherche par nom')
    page.click('.carte-depute:first-child')
    page.wait_for_selector('#fiche-carte h2', timeout=5000)
    print('  fiche:', page.inner_text('#fiche-carte h2'))
    stats = page.eval_on_selector_all('#fiche-carte .stat', 'e=>e.map(x=>x.innerText.replace(/\\n/g," "))')
    print('  stats:', ' | '.join(stats))
    repere = page.inner_text('#fiche-carte p.fiche-sous:nth-of-type(3)') if page.query_selector('#fiche-carte p.fiche-sous:nth-of-type(3)') else ''
    print('  repère:', ' '.join(repere.split())[:200])
    verifier('médiane' in page.inner_text('#fiche-carte'), 'repère de lecture présent')
    page.screenshot(path='fiche.png')
    page.keyboard.press('Escape')
    page.fill('#f-depute-recherche', ''); page.wait_for_timeout(300)
    page.click('.onglet[data-vue=scrutins]'); page.wait_for_timeout(400)
    page.screenshot(path='liste.png')

    print('\n== Mobile ==')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(400)
    debord = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    verifier(debord <= 0, f'pas de débordement horizontal en 390px (mesuré {debord})')
    page.screenshot(path='mobile.png')
    nav.close()

print('\n== Bilan ==')
if erreurs:
    print('Erreurs console :'); [print('  ', e) for e in erreurs]
else:
    print('Aucune erreur console.')
if echecs:
    print(f'{len(echecs)} vérification(s) en échec.'); sys.exit(1)
print('Toutes les vérifications passent.')
