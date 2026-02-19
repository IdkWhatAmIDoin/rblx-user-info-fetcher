export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), { status: 405 });
    }

    try {
      const body = await request.json();
      let userId = body.userId;
      const username = body.username;
      const groupId = body.groupId;

      // if user is using username instead of userid, handles it correctly
      if (!userId && username) {
        const userRes = await fetch("https://users.roblox.com/v1/usernames/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const userData = await userRes.json();
        if (userData.data && userData.data.length > 0) {
          userId = userData.data[0].id; 
        } else {
          return new Response(JSON.stringify({ error: "Username not found on Roblox" }), { status: 404 });
        }
      }
      // BREAKING NEWS!!! dumbasses dont provide a username OR an id!!!
      if (!userId) {
        return new Response(JSON.stringify({ error: "No userId or username provided" }), { status: 400 });
      }

      // fetches user id and group info about the user
      const [profileRes, groupsRes] = await Promise.all([
        fetch(`https://users.roblox.com/v1/users/${userId}`),
        fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`)
      ]);

      // handler of errors that can be caused by the roblxo api
      if (!profileRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch user profile" }), { status: profileRes.status });
      }
      if (!groupsRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch user groups" }), { status: groupsRes.status });
      }

      const profile = await profileRes.json();
      const groupsData = await groupsRes.json();

      // group list
      const groups = groupsData.data.map(g => ({
        groupId: g.group.id,
        groupName: g.group.name,
        memberCount: g.group.memberCount,
        roleId: g.role.id,
        roleName: g.role.name,
        rank: g.role.rank,
        isPrimary: g.isPrimaryGroup
      }));

      let groupMatch = null;
      if (groupId) {
        groupMatch = groupsData.data.find(g => g.group.id === parseInt(groupId));
      }

      // response
      const response = {
        id: profile.id,
        username: profile.name,
        displayName: profile.displayName,
        created: profile.created,
        profileUrl: `https://www.roblox.com/users/${profile.id}/profile`,
        groups: groups,
        requestedGroup: groupMatch ? {
          groupId: groupMatch.group.id,
          groupName: groupMatch.group.name,
          roleId: groupMatch.role.id,
          roleName: groupMatch.role.name,
          rank: groupMatch.role.rank,
          isPrimary: groupMatch.isPrimaryGroup
        } : null
      };
      // small thing i wanted to add but i dont think its rlly necessary anymore so nah
      /*
      const avatarRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=48x48&format=Png`);
      if (avatarRes.ok) {
        const avatarData = await avatarRes.json();
        response.avatarUrl = avatarData.data?.[0]?.imageUrl || null;
      }
      leaving this in so that yall can look
      */
      return new Response(JSON.stringify(response), { 
        headers: { "Content-Type": "application/json" } 
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Worker Error", detail: err.message }), { 
        status: 400, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  }
}
