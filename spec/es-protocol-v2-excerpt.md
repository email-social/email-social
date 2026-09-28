# Email Social Protocol — public excerpt of the v2 working spec (chapters 1, 2, 4)

Source: internal working draft `es-protocol-v2.md` (2026). This excerpt covers the identity layer, the data model and the e-mail integration, which is all the first implementation slice needs. Chapters 3 (federation) and 5 (HTTP API) are intentionally left out for now; end-to-end encryption is out of scope of this repository. Prose is Czech in this draft; Task 3 produces the English public spec from it. Licensed CC BY 4.0.

## 1. Identity Layer

### 1.1 Decentralized Identifiers (DIDs)

Každý uživatel má stabilní DID nezávislý na konkrétní email adrese.

**Format:**
```
did:es:<domain>:<local-identifier>

Příklady:
did:es:mail.example.com:abc123
did:es:gmail.com:user-uuid-here
```

**Komponenty:**
- `es` - DID method identifier
- `<domain>` - DNS domain ES serveru
- `<local-identifier>` - Unikátní identifikátor v rámci serveru (UUID / hash)

### 1.2 DID Document

DID Document obsahuje klíčové informace o účtu.

**Struktura:**
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://email.social/ns/es/v1"
  ],
  "id": "did:es:mail.example.com:abc123",

  "alsoKnownAs": [
    "mailto:user@example.com",
    "mailto:user.work@company.com"
  ],

  "verificationMethod": [
    {
      "id": "did:es:mail.example.com:abc123#key-1",
      "type": "Multikey",
      "controller": "did:es:mail.example.com:abc123",
      "publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }
  ],

  "authentication": [
    "did:es:mail.example.com:abc123#key-1"
  ],

  "service": [
    {
      "id": "#es-pds",
      "type": "ESPersonalDataServer",
      "serviceEndpoint": "https://mail.example.com/es/v1"
    },
    {
      "id": "#es-relay",
      "type": "ESRelay",
      "serviceEndpoint": "wss://mail.example.com/es/relay"
    }
  ],

  "created": "2024-10-10T12:00:00Z",
  "updated": "2024-10-10T12:00:00Z"
}
```

**Klíčové vlastnosti:**
- `alsoKnownAs` - Všechny email adresy uživatele (handles)
- `verificationMethod` - Public keys pro ověření podpisů
- `service` - Endpoints pro komunikaci s ES serverem

### 1.3 Handle Resolution

Handle (email adresa) se resolvuje na DID pomocí DNS TXT recordu nebo HTTP well-known.

**DNS TXT:**
```
_es.user.example.com. TXT "did=did:es:mail.example.com:abc123"
```

**HTTP Well-Known:**
```
GET https://example.com/.well-known/es-did?handle=user@example.com

Response:
{
  "did": "did:es:mail.example.com:abc123",
  "updated": "2024-10-10T12:00:00Z"
}
```

**Bidirectional Validation:**
1. Handle → DID (přes DNS/HTTP)
2. DID → Handle (přes `alsoKnownAs` v DID Document)

### 1.4 Account Portability

Uživatel může migrovat mezi ES servery změnou DID Document.

**Migration Process:**
```
1. User na starém serveru (old.com):
   did:es:old.com:abc123
   handle: user@example.com

2. User vytvoří účet na novém serveru (new.com)

3. Update DID Document:
   - service.endpoint → https://new.com/es/v1

4. Update DNS/Well-Known:
   user@example.com → did:es:new.com:xyz789

5. Repository migration:
   - Export z old.com
   - Import do new.com
   - Verify CIDs
```


## 2. Data Model & Lexicons

### 2.1 Repository Structure

Každý uživatel má repository pro ukládání záznamů.

**Repository URI:**
```
at://did:es:mail.example.com:abc123
```

**Collections:**
```
at://did:es:mail.example.com:abc123/
  ├── es.social.post/          # Posty
  ├── es.social.reaction/      # Reakce
  ├── es.social.follow/        # Sledování
  ├── es.social.profile/       # Profil
  ├── es.social.thread/        # Thread metadata
  └── es.moderation.report/    # Hlášení obsahu
```

### 2.2 Record Structure

Každý záznam má standardizovanou strukturu.

**Record URI:**
```
at://<did>/<collection>/<rkey>

Příklad:
at://did:es:mail.example.com:abc123/es.social.post/3k2a4b5c6d
```

**Record Object:**
```json
{
  "$type": "es.social.post",
  "uri": "at://did:es:mail.example.com:abc123/es.social.post/3k2a4b5c6d",
  "cid": "bafyreihxr2je5dnp6oq3y3za4xqw27qpg7kvr3rmso7fmxjkybqpwv6lt4",
  "value": {
    // Record-specific data (viz Lexicons)
  },
  "author": "did:es:mail.example.com:abc123",
  "createdAt": "2024-10-10T12:00:00.000Z",
  "updatedAt": "2024-10-10T12:05:00.000Z"
}
```

**Klíčové vlastnosti:**
- `$type` - Lexicon type
- `uri` - AT URI záznamu
- `cid` - Content Identifier (hash)
- `value` - Data záznamu (podle lexiconu)
- `author` - DID autora
- `createdAt` / `updatedAt` - Timestamps

### 2.3 Lexicons

Lexicons definují schémata pro různé typy obsahu.

#### 2.3.1 es.social.post

Post (email zpráva s ES vrstvou).

```typescript
{
  lexicon: 1,
  id: "es.social.post",
  defs: {
    main: {
      type: "record",
      description: "A post in Email.Social",
      key: "tid",
      record: {
        type: "object",
        required: ["text", "createdAt", "via"],
        properties: {
          text: {
            type: "string",
            maxLength: 10000,
            description: "Post content"
          },
          via: {
            type: "string",
            format: "email",
            description: "Email address used for sending"
          },
          createdAt: {
            type: "string",
            format: "datetime",
            description: "Creation timestamp"
          },

          // Email metadata
          email: {
            type: "object",
            properties: {
              messageId: { type: "string" },
              subject: { type: "string", maxLength: 500 },
              inReplyTo: { type: "string" },
              references: { type: "array", items: { type: "string" } }
            }
          },

          // Rich content
          facets: {
            type: "array",
            description: "Annotations (mentions, links, hashtags)",
            items: { type: "ref", ref: "#facet" }
          },
          embed: {
            type: "union",
            refs: [
              "#embedImages",
              "#embedExternal",
              "#embedRecord"
            ]
          },

          // Visibility & targeting
          visibility: {
            type: "string",
            enum: ["public", "followers", "private"],
            default: "public"
          },
          geo: {
            type: "object",
            properties: {
              regions: { type: "array", items: { type: "string" } },
              coordinates: {
                type: "object",
                properties: {
                  lat: { type: "number" },
                  lon: { type: "number" }
                }
              }
            }
          },

          // Thread context
          reply: {
            type: "object",
            properties: {
              parent: { type: "string", format: "at-uri" },
              root: { type: "string", format: "at-uri" }
            }
          },

          // Languages
          langs: {
            type: "array",
            items: { type: "string", format: "language" },
            maxLength: 3
          }
        }
      }
    },

    facet: {
      type: "object",
      required: ["index", "features"],
      properties: {
        index: {
          type: "object",
          properties: {
            byteStart: { type: "integer", minimum: 0 },
            byteEnd: { type: "integer", minimum: 0 }
          }
        },
        features: {
          type: "array",
          items: {
            type: "union",
            refs: ["#mention", "#link", "#hashtag"]
          }
        }
      }
    },

    mention: {
      type: "object",
      required: ["did"],
      properties: {
        did: { type: "string", format: "did" }
      }
    },

    link: {
      type: "object",
      required: ["uri"],
      properties: {
        uri: { type: "string", format: "uri" }
      }
    },

    hashtag: {
      type: "object",
      required: ["tag"],
      properties: {
        tag: { type: "string", maxLength: 64 }
      }
    },

    embedImages: {
      type: "object",
      required: ["images"],
      properties: {
        images: {
          type: "array",
          items: { type: "ref", ref: "#image" },
          maxLength: 4
        }
      }
    },

    image: {
      type: "object",
      required: ["alt", "image"],
      properties: {
        alt: { type: "string", maxLength: 1000 },
        image: { type: "blob", accept: ["image/*"], maxSize: 10000000 },
        aspectRatio: {
          type: "object",
          properties: {
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 }
          }
        }
      }
    },

    embedExternal: {
      type: "object",
      required: ["external"],
      properties: {
        external: {
          type: "object",
          required: ["uri", "title", "description"],
          properties: {
            uri: { type: "string", format: "uri" },
            title: { type: "string", maxLength: 500 },
            description: { type: "string", maxLength: 2000 },
            thumb: { type: "blob", accept: ["image/*"], maxSize: 1000000 }
          }
        }
      }
    },

    embedRecord: {
      type: "object",
      required: ["record"],
      properties: {
        record: { type: "string", format: "at-uri" }
      }
    }
  }
}
```

#### 2.3.2 es.social.reaction

Reakce na post.

```typescript
{
  lexicon: 1,
  id: "es.social.reaction",
  defs: {
    main: {
      type: "record",
      description: "A reaction to content",
      key: "tid",
      record: {
        type: "object",
        required: ["subject", "reaction", "createdAt"],
        properties: {
          subject: {
            type: "string",
            format: "at-uri",
            description: "URI of the content being reacted to"
          },
          reaction: {
            type: "string",
            enum: ["like", "love", "laugh", "surprised", "sad", "angry"],
            description: "Reaction type (or custom emoji)"
          },
          emoji: {
            type: "string",
            maxLength: 10,
            description: "Custom emoji reaction"
          },
          createdAt: {
            type: "string",
            format: "datetime"
          }
        }
      }
    }
  }
}
```

#### 2.3.3 es.social.follow

Sledování uživatele.

```typescript
{
  lexicon: 1,
  id: "es.social.follow",
  defs: {
    main: {
      type: "record",
      description: "A social follow",
      key: "tid",
      record: {
        type: "object",
        required: ["subject", "createdAt"],
        properties: {
          subject: {
            type: "string",
            format: "did",
            description: "DID of the user being followed"
          },
          createdAt: {
            type: "string",
            format: "datetime"
          }
        }
      }
    }
  }
}
```

#### 2.3.4 es.social.profile

Uživatelský profil.

```typescript
{
  lexicon: 1,
  id: "es.social.profile",
  defs: {
    main: {
      type: "record",
      description: "User profile",
      key: "self",
      record: {
        type: "object",
        properties: {
          displayName: {
            type: "string",
            maxLength: 100
          },
          description: {
            type: "string",
            maxLength: 2000,
            description: "Bio"
          },
          avatar: {
            type: "blob",
            accept: ["image/png", "image/jpeg"],
            maxSize: 1000000
          },
          banner: {
            type: "blob",
            accept: ["image/png", "image/jpeg"],
            maxSize: 2000000
          },

          // Contact & links
          website: {
            type: "string",
            format: "uri"
          },
          location: {
            type: "string",
            maxLength: 100
          },

          // Social links
          social: {
            type: "object",
            properties: {
              bluesky: { type: "string" },
              github: { type: "string" },
              twitter: { type: "string" },
              linkedin: { type: "string" }
            }
          },

          // Custom fields
          customFields: {
            type: "array",
            maxLength: 10,
            items: {
              type: "object",
              properties: {
                key: { type: "string", maxLength: 50 },
                value: { type: "string", maxLength: 200 }
              }
            }
          },

          // Verification
          verification: {
            type: "object",
            properties: {
              level: {
                type: "string",
                enum: ["none", "basic", "professional", "official"]
              },
              type: {
                type: "string",
                enum: ["individual", "organization", "government", "journalist", "developer"]
              },
              proofs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    url: { type: "string", format: "uri" },
                    verified: { type: "boolean" }
                  }
                }
              }
            }
          },

          updatedAt: {
            type: "string",
            format: "datetime"
          }
        }
      }
    }
  }
}
```

### 2.4 Content Addressing (CID)

Každý záznam má Content Identifier generovaný z jeho obsahu.

**CID Generation:**
```javascript
import { CID } from 'multiformats/cid';
import * as dagCBOR from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';

async function generateCID(record) {
  // Serialize to DAG-CBOR
  const bytes = dagCBOR.encode(record);

  // Hash
  const hash = await sha256.digest(bytes);

  // Create CID
  const cid = CID.create(1, dagCBOR.code, hash);

  return cid.toString();
}
```

**Příklad:**
```javascript
const record = {
  $type: 'es.social.post',
  text: 'Hello Email.Social!',
  createdAt: '2024-10-10T12:00:00.000Z',
  via: 'user@example.com'
};

const cid = await generateCID(record);
// → "bafyreihxr2je5dnp6oq3y3za4xqw27qpg7kvr3rmso7fmxjkybqpwv6lt4"
```

### 2.5 Cryptographic Signatures

Všechny záznamy jsou podepsány autorovou private key.

**Signature Format:**
```json
{
  "record": { /* záznam */ },
  "signature": {
    "type": "ES256K",
    "created": "2024-10-10T12:00:00Z",
    "verificationMethod": "did:es:mail.example.com:abc123#key-1",
    "signatureValue": "base64-encoded-signature"
  }
}
```

**Verification:**
```javascript
async function verifyRecord(signedRecord) {
  const { record, signature } = signedRecord;

  // 1. Generate CID from record
  const cid = await generateCID(record);

  // 2. Resolve DID Document
  const didDoc = await resolveDID(record.author);

  // 3. Get public key
  const publicKey = didDoc.verificationMethod.find(
    vm => vm.id === signature.verificationMethod
  );

  // 4. Verify signature
  const verified = await verifySignature(
    cid,
    signature.signatureValue,
    publicKey.publicKeyMultibase
  );

  return verified;
}
```


## 4. Email Integration

### 4.1 ES Layer in Email

ES data jsou vložena do emailu jako speciální sekce.

**Email Structure:**
```
From: user@example.com
To: recipient@other.com
Subject: Hello Email.Social!
Content-Type: multipart/alternative; boundary="es-boundary"

--es-boundary
Content-Type: text/plain; charset=utf-8

Hello Email.Social!

This is a test message.

--es-boundary
Content-Type: text/html; charset=utf-8

<html>
  <body>
    <p>Hello Email.Social!</p>
    <p>This is a test message.</p>
  </body>
</html>

--es-boundary
Content-Type: application/vnd.es.social+json; version=2.0
Content-Disposition: inline; filename="es-data.json"

{
  "$type": "es.social.post",
  "uri": "at://did:es:mail.example.com:abc123/es.social.post/3k2a4b5c6d",
  "cid": "bafyreihxr2je5dnp6oq3y3za4xqw27qpg7kvr3rmso7fmxjkybqpwv6lt4",
  "value": {
    "text": "Hello Email.Social!\n\nThis is a test message.",
    "createdAt": "2024-10-10T12:00:00.000Z",
    "via": "user@example.com",
    "email": {
      "messageId": "<unique-id@mail.example.com>",
      "subject": "Hello Email.Social!"
    }
  },
  "author": "did:es:mail.example.com:abc123",
  "signature": {
    "type": "ES256K",
    "created": "2024-10-10T12:00:00Z",
    "verificationMethod": "did:es:mail.example.com:abc123#key-1",
    "signatureValue": "..."
  }
}

--es-boundary--
```

**Klíčové body:**
- Plain text a HTML pro kompatibilitu
- ES data jako `application/vnd.es.social+json`
- Signatura přímo v ES části

### 4.2 DKIM Integration

ES využívá existující DKIM pro dodatečnou validaci.

**Validation Steps:**
```
1. DKIM validation (standardní email)
2. ES signature verification (ES layer)
3. DID resolution a verification
4. Timestamp validation
```

### 4.3 Threading

ES používá email threading headers + vlastní thread metadata.

**Email Headers:**
```
Message-ID: <post-3k2a4b5c6d@mail.example.com>
In-Reply-To: <post-parent@mail.example.com>
References: <post-root@mail.example.com> <post-parent@mail.example.com>
```

**ES Thread Metadata:**
```json
{
  "reply": {
    "root": "at://did:es:.../es.social.post/root-rkey",
    "parent": "at://did:es:.../es.social.post/parent-rkey"
  }
}
```

