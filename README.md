# Roblox User Info Fetcher

fetch info about any roblox user. groups, presence, avatar, social counts, and more.

[![Status](http://185.68.244.71:3001/api/status-page/rblx-user-info-fetcher/badge?style=flat-square)](http://185.68.244.71:3001/status/rblx-user-info-fetcher)

> [!CAUTION]
> we use a ratelimiting system like all other API's do.
>
> - **50 requests** per 60 seconds per IP
> - exceeding this gets you banned for **1 hour**

---

## Endpoint

`POST` `https://rbx-group-fetcher.dimasuperotovorot3000.workers.dev/`

---

## Request Body

provide at least one of `username` or `userId`:

```json
{
  "username": "PapaAleks11"
}
```

### Fields

| field | type | required | description |
|---|---|---|---|
| `username` | string | one of these two | roblox username |
| `userId` | number | one of these two | roblox user id |
| `groupId` | number | no | filter groups by id; adds `requestedGroup` to the response |
| `includeAvatar` | bool | no | headshot url (default: `false`) |
| `includePresence` | bool | no | current presence / game / location (default: `false`) |
| `includeFriendsCount` | bool | no | friend count (default: `false`) |
| `includeFollowersCount` | bool | no | follower count (default: `false`) |
| `includeFollowingCount` | bool | no | following count (default: `false`) |
| `includeGroups` | bool | no | group memberships (default: `true`) |
| `includeCool` | bool | no | IS THAT GUY COOL BRO IS HE COOL (default: `false`) |

> [!IMPORTANT]
> this API accepts any **bool truthy-falsy values**.
>
>**truthy:** `true`, `"true"`, `"1"`, `"on"`, any non-zero number
>
>**falsy:** `false`, `"false"`, `"0"`, `"off"`, `null`, `undefined`
>
> passing anything else (e.g. an array or object) returns a `400` error.

---

## Full Example Request

```json
{
  "username": "PapaAleks11",
  "userId": 1478795848,
  "groupId": 4914494,
  "includeAvatar": true,
  "includePresence": true,
  "includeFriendsCount": true,
  "includeFollowersCount": true,
  "includeFollowingCount": true,
  "includeGroups": true
}
```

---

## Example Response

```json
{
  "id": 1478795848,
  "username": "PapaAleks11",
  "displayName": "Dima",
  "created": "2020-02-27T07:16:28.267Z",
  "profileUrl": "https://www.roproxy.com/users/1478795848/profile",
  "description": "oh hi!",
  "groups": [
    {
      "groupId": 4914494,
      "groupName": "Paradoxum Games",
      "memberCount": 5742975,
      "roleId": 32808020,
      "roleName": "Player",
      "rank": 1
    }
  ]
}
```

---
