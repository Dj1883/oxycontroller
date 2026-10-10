const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const roblox = require('../../services/roblox');
const db = require('../../db/database');

const {
  text,
  v2Payload,
  modalWithSelect,
  modalWithText,
  row
} = require('../../utils/components');

function createRobloxModal() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('roblox:action')
    .setPlaceholder('Choose an action')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      {
        label: 'Link account',
        description: 'Start linking your Roblox account',
        value: 'link'
      },
      {
        label: 'Verify account',
        description: 'Verify the key in your Roblox description',
        value: 'verify'
      },
      {
        label: 'View linked account',
        description: 'View your currently linked Roblox account',
        value: 'profile'
      },
      {
        label: 'Unlink account',
        description: 'Remove your Roblox account link',
        value: 'unlink'
      }
    );

  return modalWithSelect({
    customId: 'roblox:menu',
    title: 'Roblox Account',
    label: 'Roblox action',
    description: 'Select what you want to do.',
    selectComponent: menu
  });
}

function createButton(customId, label) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(ButtonStyle.Primary);
}

async function verifyAccount(interaction) {
  const account = db.getAccount(interaction.user.id);

  if (!account || !account.verification_code_hash) {
    return interaction.reply(
      v2Payload(
        [
          {
            type: 'text',
            value: text(
              'You do not have a pending Roblox link. Use **/roblox** and choose **Link account** first.'
            )
          }
        ],
        { ephemeral: true }
      )
    );
  }

  if (
    account.verification_expires_at &&
    Date.now() > Number(account.verification_expires_at)
  ) {
    return interaction.reply(
      v2Payload(
        [
          {
            type: 'text',
            value: text(
              'Your verification key has expired. Start the linking process again.'
            )
          }
        ],
        { ephemeral: true }
      )
    );
  }

  try {
    const user = await roblox.getUser(account.roblox_user_id);

    if (!roblox.findMatchingCode(user.description || '', account.verification_code_hash)) {
      return interaction.reply(
        v2Payload(
          [
            {
              type: 'text',
              value: text(
                `I could not verify the key in **${user.name}**'s description.

Make sure the exact key is in your Roblox profile description, then try again.`
              )
            }
          ],
          { ephemeral: true }
        )
      );
    }

    db.upsertAccount(interaction.user.id, {
      roblox_user_id: account.roblox_user_id,
      roblox_username: user.name,
      verification_code_hash: null,
      verification_code: null,
      verification_expires_at: null,
      linked_at: Date.now()
    });

    return interaction.reply(
      v2Payload(
        [
          {
            type: 'text',
            value: text(
              `## Roblox Account Linked

Successfully linked your Discord account to **${user.name}**.

You can now use Oxy's Roblox features.`
            )
          }
        ],
        { ephemeral: true }
      )
    );
  } catch (error) {
    console.error('Roblox verification failed:', error);

    return interaction.reply(
      v2Payload(
        [
          {
            type: 'text',
            value: text(
              'I could not contact Roblox right now. Please try again shortly.'
            )
          }
        ],
        { ephemeral: true }
      )
    );
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Link and manage your Roblox account'),

  async execute(interaction) {
    return interaction.showModal(createRobloxModal());
  },

  async handleModal(interaction) {
    if (interaction.customId === 'roblox:menu') {
      const selected =
        interaction.fields.getStringSelectValues('roblox:action')[0];

      if (selected === 'link') {
        return interaction.reply(
          v2Payload(
            [
              {
                type: 'text',
                value: text(
                  '## Link Roblox Account\n\nClick the button below to enter your Roblox username.'
                )
              },
              {
                type: 'row',
                value: row([
                  createButton(
                    'roblox:enter-username',
                    'Enter Roblox Username'
                  )
                ])
              }
            ],
            { ephemeral: true }
          )
        );
      }

      if (selected === 'verify') {
        return verifyAccount(interaction);
      }

      if (selected === 'profile') {
        const account = db.getAccount(interaction.user.id);

        if (!account || !account.linked_at) {
          return interaction.reply(
            v2Payload(
              [
                {
                  type: 'text',
                  value: text(
                    'You do not currently have a linked Roblox account.'
                  )
                }
              ],
              { ephemeral: true }
            )
          );
        }

        return interaction.reply(
          v2Payload(
            [
              {
                type: 'text',
                value: text(
                  `## Linked Roblox Account

**Username:** ${account.roblox_username}
**User ID:** ${account.roblox_user_id}
**Linked:** <t:${Math.floor(Number(account.linked_at) / 1000)}:R>`
                )
              }
            ],
            { ephemeral: true }
          )
        );
      }

      if (selected === 'unlink') {
        db.clearAccount(interaction.user.id);

        return interaction.reply(
          v2Payload(
            [
              {
                type: 'text',
                value: text(
                  'Your Roblox account link has been removed.'
                )
              }
            ],
            { ephemeral: true }
          )
        );
      }

      return false;
    }

    if (interaction.customId === 'roblox:link') {
      try {
        const username = interaction.fields
          .getTextInputValue('username')
          .trim();

        if (!username) {
          return interaction.reply(
            v2Payload(
              [
                {
                  type: 'text',
                  value: text('Please enter a Roblox username.')
                }
              ],
              { ephemeral: true }
            )
          );
        }

        const user = await roblox.findUserByUsername(username);

        const existing = db.getAccountByRobloxId(user.id);

        if (
          existing &&
          existing.discord_id &&
          existing.discord_id !== interaction.user.id
        ) {
          return interaction.reply(
            v2Payload(
              [
                {
                  type: 'text',
                  value: text(
                    'That Roblox account is already linked to another Discord account.'
                  )
                }
              ],
              { ephemeral: true }
            )
          );
        }

        const code = roblox.makeCode();

        db.upsertAccount(interaction.user.id, {
          roblox_user_id: user.id,
          roblox_username: user.name,
          verification_code_hash: roblox.hashCode(code),
          verification_code: null,
          verification_expires_at: Date.now() + 15 * 60 * 1000,
          linked_at: null
        });

        return interaction.reply(
          v2Payload(
            [
              {
                type: 'text',
                value: text(
                  `## Roblox Account Linking

**Roblox account:** ${user.name}

Put the following key somewhere in your Roblox profile description:

### \`${code}\`

Once you've added it, open **/roblox** again and select **Verify account**.

**The key expires in 15 minutes.**`
                )
              }
            ],
            { ephemeral: true }
          )
        );
      } catch (error) {
        console.error('Roblox linking failed:', error);

        return interaction.reply(
          v2Payload(
            [
              {
                type: 'text',
                value: text(
                  error.message ||
                    'I could not find that Roblox account.'
                )
              }
            ],
            { ephemeral: true }
          )
        );
      }
    }

    return false;
  },

  async handleButton(interaction) {
    if (interaction.customId !== 'roblox:enter-username') {
      return false;
    }

    return interaction.showModal(
      modalWithText({
        customId: 'roblox:link',
        title: 'Link Roblox Account',
        label: 'Roblox username',
        description: 'Enter the Roblox username you want to link.',
        inputId: 'username',
        maxLength: 50
      })
    );
  }
};
