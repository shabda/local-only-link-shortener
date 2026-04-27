"""URL shorteners — each version a different trick stacked on the prior.

A shortener is anything with .name, .encode(url) -> str, .decode(str) -> url.
encode/decode must round-trip exactly on the corpus.
"""

import base64


class V1Passthrough:
    name = "v1-passthrough"

    def encode(self, url: str) -> str:
        return url

    def decode(self, payload: str) -> str:
        return payload


class V2Base64:
    """UTF-8 -> base64. Should be ~1.33x worse; here to anchor the chart."""
    name = "v2-base64"

    def encode(self, url: str) -> str:
        return base64.b64encode(url.encode("utf-8")).decode("ascii")

    def decode(self, payload: str) -> str:
        return base64.b64decode(payload.encode("ascii")).decode("utf-8")


VERSIONS = [V1Passthrough(), V2Base64()]
