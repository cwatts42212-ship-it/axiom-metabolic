#!/usr/bin/env python3
"""
Encrypts and uploads all required GitHub Actions secrets for the Axiom Metabolic
Oxygen deployment workflow using the GitHub REST API and libsodium encryption.
"""
import base64
import json
import os
import sys
import urllib.request
import urllib.error

try:
    from nacl import encoding, public
except ImportError:
    os.system("sudo pip3 install PyNaCl -q")
    from nacl import encoding, public


GITHUB_TOKEN = "YOUR_GITHUB_PAT"
REPO = "cwatts42212-ship-it/storefront"
PUBLIC_KEY_ID = "3380204578043523366"
PUBLIC_KEY_B64 = "VElnzP75SYSM6wg4JiQg/Ygqk4V6W9GMUN7Sf7srG3s="

# All secrets to set
SECRETS = {
    "SESSION_SECRET": "axiom-metabolic-super-secret-session-key-2026",
    "PUBLIC_STORE_DOMAIN": "axiom-metabolic.myshopify.com",
    "PUBLIC_STOREFRONT_API_TOKEN": "6bd038f15abb1e1ea1869ecd008e2654",
    "SHOPIFY_ADMIN_API_TOKEN": "YOUR_SHOPIFY_ADMIN_API_TOKEN",
    "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", ""),
    "KLAVIYO_PRIVATE_API_KEY": "KLAVIYO_PRIVATE_KEY_PLACEHOLDER",
    "KLAVIYO_PUBLIC_API_KEY": "KLAVIYO_PUBLIC_KEY_PLACEHOLDER",
    "VENDOR_EMAIL": "cwatts42212@gmail.com",
    "COACH_EMAIL": "cwatts42212@gmail.com",
    "COACHING_TIER1_VARIANT_ID": "49906823725374",
    "COACHING_TIER2_VARIANT_ID": "49906823758142",
    "COACHING_TIER3_VARIANT_ID": "49906823790910",
    # SHOPIFY_HYDROGEN_DEPLOYMENT_TOKEN will be set separately once revealed
}


def encrypt_secret(public_key_b64: str, secret_value: str) -> str:
    """Encrypt a secret value using the repository's public key."""
    public_key_bytes = base64.b64decode(public_key_b64)
    sealed_box = public.SealedBox(public.PublicKey(public_key_bytes))
    encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


def set_secret(name: str, value: str) -> bool:
    """Upload an encrypted secret to the GitHub repository."""
    if not value:
        print(f"  SKIP  {name} (empty value)")
        return False

    encrypted_value = encrypt_secret(PUBLIC_KEY_B64, value)
    payload = json.dumps({
        "encrypted_value": encrypted_value,
        "key_id": PUBLIC_KEY_ID
    }).encode("utf-8")

    url = f"https://api.github.com/repos/{REPO}/actions/secrets/{name}"
    req = urllib.request.Request(
        url,
        data=payload,
        method="PUT",
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    )

    try:
        with urllib.request.urlopen(req) as response:
            status = response.status
            if status in (201, 204):
                print(f"  OK    {name}")
                return True
            else:
                print(f"  FAIL  {name} (HTTP {status})")
                return False
    except urllib.error.HTTPError as e:
        print(f"  ERR   {name} (HTTP {e.code}: {e.read().decode()})")
        return False


def main():
    print(f"\nUploading {len(SECRETS)} secrets to {REPO}...\n")
    success = 0
    for name, value in SECRETS.items():
        if set_secret(name, value):
            success += 1

    print(f"\nDone: {success}/{len(SECRETS)} secrets uploaded successfully.")
    if success < len(SECRETS):
        print("Note: SHOPIFY_HYDROGEN_DEPLOYMENT_TOKEN must be set manually.")
        sys.exit(1)


if __name__ == "__main__":
    main()
