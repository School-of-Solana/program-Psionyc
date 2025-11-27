/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/real_estate.json`.
 */
export type RealEstate = {
  "address": "3U6NSTN5Pm9VaMeTCdYq9RFUddeStn4zn63uXm33dr4A",
  "metadata": {
    "name": "realEstate",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "createProperty",
      "discriminator": [
        45,
        115,
        89,
        113,
        193,
        252,
        125,
        27
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  101,
                  114,
                  116,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "property",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "imageUrl",
          "type": "string"
        }
      ]
    },
    {
      "name": "fundProperty",
      "discriminator": [
        153,
        177,
        202,
        89,
        138,
        82,
        224,
        28
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "propertyVault",
          "docs": [
            "Create the vault on first use, else just load it"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  101,
                  114,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "propertyId"
              }
            ]
          }
        },
        {
          "name": "paymentRecord",
          "docs": [
            "One record per (user, property). Updated, not re-created."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "propertyId"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "propertyId",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawMaster",
      "discriminator": [
        223,
        5,
        0,
        183,
        16,
        8,
        101,
        232
      ],
      "accounts": [
        {
          "name": "master",
          "docs": [
            "Only this multisig key may sign"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "propertyVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  101,
                  114,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "propertyId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "propertyId",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawMyPayment",
      "discriminator": [
        184,
        58,
        237,
        254,
        78,
        73,
        43,
        198
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true,
          "relations": [
            "paymentRecord"
          ]
        },
        {
          "name": "paymentRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "propertyId"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "propertyVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  101,
                  114,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "propertyId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "propertyId",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "paymentRecord",
      "discriminator": [
        202,
        168,
        56,
        249,
        127,
        226,
        86,
        226
      ]
    },
    {
      "name": "property",
      "discriminator": [
        195,
        247,
        69,
        181,
        195,
        47,
        152,
        19
      ]
    },
    {
      "name": "propertyRegistry",
      "discriminator": [
        240,
        117,
        59,
        100,
        129,
        78,
        224,
        201
      ]
    },
    {
      "name": "propertyVault",
      "discriminator": [
        8,
        22,
        82,
        123,
        16,
        77,
        38,
        145
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyWithdrawn",
      "msg": "Payment already withdrawn"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6002,
      "name": "insufficientFunds",
      "msg": "Insufficient deposit balance"
    },
    {
      "code": 6003,
      "name": "vaultInsufficientFunds",
      "msg": "Insufficient funds in the vault"
    },
    {
      "code": 6004,
      "name": "nameTooLong",
      "msg": "Property name too long"
    },
    {
      "code": 6005,
      "name": "imageUrlTooLong",
      "msg": "Image URL too long"
    },
    {
      "code": 6006,
      "name": "idOverflow",
      "msg": "Property id overflow"
    }
  ],
  "types": [
    {
      "name": "paymentRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "propertyId",
            "type": "u32"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "property",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "propertyId",
            "type": "u32"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "imageUrl",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "propertyRegistry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nextPropertyId",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "propertyVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "propertyId",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
