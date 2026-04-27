"""URL shorteners — each version a different trick stacked on the prior.

A shortener is anything with .name, .encode(url) -> str, .decode(str) -> url.
encode/decode must round-trip exactly on the corpus.
"""


class V1Passthrough:
    name = "v1-passthrough"

    def encode(self, url: str) -> str:
        return url

    def decode(self, payload: str) -> str:
        return payload


VERSIONS = [V1Passthrough()]
