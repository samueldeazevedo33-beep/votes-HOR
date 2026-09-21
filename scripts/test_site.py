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
RACINE = os.environ.get('SITE_URL', 'http://localhost:8777')

erreurs, echecs = [], []


def verifier(condition, message):
    print(f"  {'ok   ' if condition else 'ECHEC'} {message}")
    if not condition:
        echecs.append(message)


def nombre(texte):
    chiffres = ''.join(c for c in texte if c.isdigit())
    return int(chiffres) if chiffres else 0


with sync_playwright() as p:
    lancement = {'args': ['--no-sandbox']}
    if CHROME:
        lancement['executable_path'] = CHROME
    nav = p.chromium.launch(**lancement)
    page = nav.new_page(viewport={'width': 1280, 'height': 1000})
    page.on('console', lambda m: erreurs.append(f'CONSOLE {m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: erreurs.append(f'PAGEERROR: {e}'))

    print('\n== Chargement ==')
    page.goto(f'{RACINE}/index.html')
    page.wait_for_selector('#app', state='visible', timeout=30000)
    page.wait_for_function("document.querySelectorAll('#toile-groupes svg path').length > 0", timeout=30000)
    print('  entête:', page.inner_text('#entete-resume'))
    depart = page.inner_text('#compte')
    print('  compte:', ' '.join(depart.split()))
    verifier(nombre(depart.split('scrutin')[0]) > 8000, 'toute la législature est chargée')
    verifier(page.eval_on_selector_all('#toile-groupes svg path', 'e=>e.length') > 20,
             'la figure des groupes est tracée')

    print('\n== Sujet : un groupe ==')
    page.select_option('#f-texte', label=page.eval_on_selector(
        '#f-texte option:nth-child(2)', 'e=>e.label'))
    page.wait_for_timeout(500)
    print('  texte le plus fourni:', ' '.join(page.inner_text('#sous-sujet').split()))
    print('  compte:', ' '.join(page.inner_text('#compte').split()))
    verifier(page.eval_on_selector_all('#toile-sujet svg path', 'e=>e.length') >= 2,
             'la répartition du groupe est tracée')
    lignes = page.eval_on_selector_all('#toile-groupes svg text', 'e=>e.length')
    verifier(lignes > 10, 'les groupes sont étiquetés')

    print('\n== Tableaux de secours ==')
    page.eval_on_selector_all('details.tableau', 'e=>e.forEach(d=>d.open=true)')
    page.wait_for_timeout(200)
    verifier(page.eval_on_selector_all('#table-sujet tbody tr', 'e=>e.length') >= 2,
             'le tableau de la répartition existe')
    verifier(page.eval_on_selector_all('#table-groupes tbody tr', 'e=>e.length') >= 5,
             'le tableau des groupes existe')

    print('\n== Note et élément de langage ==')
    page.click('#btn-note')
    page.wait_for_selector('#modale-texte', state='visible')
    note = page.input_value('#modale-texte')
    verifier(len(note) > 300, 'la note est rédigée')
    print('\n--- NOTE ---\n' + note + '\n---')
    page.keyboard.press('Escape')
    page.click('#btn-edl')
    page.wait_for_selector('#modale-texte', state='visible')
    edl = page.input_value('#modale-texte')
    verifier(len(edl) > 200, 'l’élément de langage est rédigé')
    print('\n--- EDL ---\n' + edl + '\n---')
    page.keyboard.press('Escape')
    verifier(page.is_hidden('#modale'), 'fermeture par Échap')

    print('\n== Sujet : un député ==')
    page.check('input[name="sujet"][value="depute"]')
    page.wait_for_function(
        "document.querySelectorAll('#toile-sujet svg path').length > 0", timeout=30000)
    print('  sujet:', ' '.join(page.inner_text('#sous-sujet').split()))
    verifier(page.eval_on_selector_all('#toile-sujet svg path', 'e=>e.length') >= 2,
             'la répartition du député est tracée')
    premiere = page.eval_on_selector('#toile-groupes svg text', 'e=>e.textContent')
    verifier(page.eval_on_selector('#toile-groupes svg text', 'e=>e.getAttribute("font-weight")') == '700',
             f'le député figure en tête de la comparaison ({premiere})')
    page.click('#btn-edl')
    page.wait_for_selector('#modale-texte', state='visible')
    print('\n--- EDL député ---\n' + page.input_value('#modale-texte')[:700] + '\n---')
    page.keyboard.press('Escape')

    print('\n== Périmètre : une période ==')
    page.check('input[name="perimetre"][value="periode"]')
    page.wait_for_timeout(300)
    page.fill('#f-debut', '2025-10-01')
    page.fill('#f-fin', '2025-12-31')
    page.dispatch_event('#f-fin', 'change')
    page.wait_for_timeout(600)
    periode = page.inner_text('#compte')
    print('  compte:', ' '.join(periode.split()))
    verifier(0 < nombre(periode.split('scrutin')[0]) < 8434, 'la période restreint la sélection')

    print('\n== Export PNG ==')
    page.check('input[name="sujet"][value="groupe"]')
    page.wait_for_timeout(500)
    with page.expect_download(timeout=20000) as attente:
        page.click('[data-png="figure-groupes"]')
    telechargement = attente.value
    chemin = telechargement.path()
    taille = os.path.getsize(chemin) if chemin else 0
    print('  fichier:', telechargement.suggested_filename, f'({taille // 1024} Ko)')
    verifier(telechargement.suggested_filename.endswith('.png') and taille > 8000,
             'une image PNG exploitable est produite')

    print('\n== Liste ==')
    page.click('input[name="perimetre"][value="texte"]')
    page.wait_for_timeout(400)
    verifier(page.eval_on_selector_all('#liste .scrutin', 'e=>e.length') > 5, 'les scrutins sont listés')
    page.screenshot(path=os.environ.get('CAPTURES', '/tmp') + '/vue.png', full_page=False)

    print('\n== Mobile ==')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(400)
    debord = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    verifier(debord <= 0, f'pas de débordement horizontal en 390 px (mesuré {debord})')
    page.screenshot(path=os.environ.get('CAPTURES', '/tmp') + '/mobile.png')
    nav.close()

print('\n== Bilan ==')
if erreurs:
    print('Erreurs console :')
    for e in erreurs:
        print('  ', e)
else:
    print('Aucune erreur console.')
if echecs:
    print(f'{len(echecs)} vérification(s) en échec.')
    sys.exit(1)
print('Toutes les vérifications passent.')
