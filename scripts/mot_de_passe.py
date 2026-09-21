#!/usr/bin/env python3
"""Calcule l'empreinte a coller dans docs/config.js."""

import getpass
import hashlib
import sys

if __name__ == "__main__":
    motdepasse = sys.argv[1] if len(sys.argv) > 1 else getpass.getpass("Nouveau mot de passe : ")
    empreinte = hashlib.sha256(motdepasse.encode("utf-8")).hexdigest()
    print(f"\n  empreinteMotDePasse: '{empreinte}',\n")
    print("A reporter dans docs/config.js.")
