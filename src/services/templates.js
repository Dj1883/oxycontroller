const axios=require('axios');
const fs=require('node:fs');
const path=require('node:path');
const db=require('../db/database');
const CREATOR_IDS=()=>new Set(String(process.env.TEMPLATE_CREATOR_IDS||'1353829659082752122,1477380573235515425').split(',').map(x=>x.trim()).filter(Boolean));
const TEMPLATE_SCHEMA={
  type:'object',
  additionalProperties:false,
  required:['name','description','category','channels','roles','settings'],
  properties:{
    name:{type:'string'},
    description:{type:'string'},
    category:{type:'string'},
    roles:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['name','color','hoist','mentionable'],properties:{name:{type:'string'},color:{type:'string'},hoist:{type:'boolean'},mentionable:{type:'boolean'}}}},
    channels:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['name','type','category'],properties:{name:{type:'string'},type:{type:'string',enum:['category','text','announcement','forum','voice','stage']},category:{type:['string','null']},topic:{type:['string','null']}}}},
    settings:{
      type:'object',
      additionalProperties:false,
      required:['staff','moderation','automod','tickets','applications','suggestions','giveaways','music','shifts'],
      properties:{
        staff:{type:'object',additionalProperties:false,required:['manager','administrator','moderator','support'],properties:{manager:{type:'string'},administrator:{type:'string'},moderator:{type:'string'},support:{type:'string'}}},
        moderation:{type:'object',additionalProperties:false,required:['logging','defaultAction'],properties:{logging:{type:'boolean'},defaultAction:{type:'string',enum:['delete','warn','timeout']}}},
        automod:{type:'object',additionalProperties:false,required:['enabled','categories'],properties:{enabled:{type:'boolean'},categories:{type:'array',items:{type:'string'}}}},
        tickets:{type:'object',additionalProperties:false,required:['enabled','mode','questions'],properties:{enabled:{type:'boolean'},mode:{type:'string',enum:['panel','modmail','both']},questions:{type:'array',maxItems:5,items:{type:'string'}}}},
        applications:{type:'object',additionalProperties:false,required:['enabled','questions'],properties:{enabled:{type:'boolean'},questions:{type:'array',maxItems:5,items:{type:'string'}}}},
        suggestions:{type:'object',additionalProperties:false,required:['enabled'],properties:{enabled:{type:'boolean'}}},
        reactionRoles:{type:'object',additionalProperties:false,required:['enabled','title','description','roles'],properties:{enabled:{type:'boolean'},title:{type:'string'},description:{type:'string'},roles:{type:'array',maxItems:25,items:{type:'object',additionalProperties:false,required:['label','roleName'],properties:{label:{type:'string'},emoji:{type:['string','null']},roleName:{type:'string'},description:{type:['string','null']}}}}}},
        giveaways:{type:'object',additionalProperties:false,required:['enabled'],properties:{enabled:{type:'boolean'}}},
        music:{type:'object',additionalProperties:false,required:['enabled','defaultVolume'],properties:{enabled:{type:'boolean'},defaultVolume:{type:'integer'}}},
        shifts:{type:'object',additionalProperties:false,required:['enabled','requireMovement'],properties:{enabled:{type:'boolean'},requireMovement:{type:'boolean'}}}
      }
    }
  }
};
function systemInstructions(){const p=path.resolve(process.env.TEMPLATE_INSTRUCTIONS_PATH||'./config/templates/instructions.txt');try{return fs.readFileSync(p,'utf8').trim();}catch{return 'Create safe Oxy Controller server templates. Return only structured JSON. Never invent secrets, IDs or executable code. Keep settings practical and reviewable.';}}
function canCreate(userId){return CREATOR_IDS().has(String(userId));}
function slugify(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||`template-${Date.now()}`;}
async function generate({name,goal,createdBy}) {
  if (!canCreate(createdBy)) throw new Error('You are not authorised to create AI templates.');
  const apiKey = String(process.env.XAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('AI template generation is not configured on this Oxy instance.');
  const model = String(process.env.XAI_TEMPLATE_MODEL || 'grok-4.7').trim();
  const input = [
    { role: 'system', content: systemInstructions() },
    { role: 'user', content: `Create a server template named "${name}" for this goal: ${goal}. Design the server roles and channel structure as well. Create useful server roles such as management, moderation, support, staff, bots, or community roles when appropriate. Do not create dangerous administrator permissions. Every channel must have exactly one supported type: category, text, announcement, forum, voice, or stage. Use category to group channels and use the category field to assign child channels to a category by name.` }
  ];
  let response;
  try {
    response = await axios.post('https://api.x.ai/v1/responses', {
      model,
      input,
      text: { format: { type: 'json_schema', name: 'oxy_server_template', strict: true, schema: TEMPLATE_SCHEMA } }
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
      validateStatus: () => true
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') throw new Error('AI template generation timed out. Please try again.');
    throw new Error('Oxy could not reach the AI service. Please try again.');
  }
  if (response.status < 200 || response.status >= 300) {
    const apiError = response.data?.error;
    const message = typeof apiError === 'string' ? apiError : apiError?.message;
    if (response.status === 401) throw new Error('AI template generation could not authenticate. Check the AI service key.');
    if (response.status === 429) throw new Error('AI template generation is temporarily rate limited. Please try again shortly.');
    throw new Error(message ? `AI template generation failed: ${message}` : `AI template generation failed (HTTP ${response.status}).`);
  }
  const output = Array.isArray(response.data?.output) ? response.data.output : [];
  const message = output.find(item => item?.type === 'message');
  const contentPart = message?.content?.find(part => part?.type === 'output_text');
  const content = contentPart?.text || response.data?.output_text;
  if (!content) throw new Error('The AI service returned no template. Please try again.');
  let definition;
  try { definition = typeof content === 'string' ? JSON.parse(content) : content; }
  catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The AI service returned an invalid template. Please try again.');
    try { definition = JSON.parse(match[0]); } catch { throw new Error('The AI service returned an invalid template. Please try again.'); }
  }
  if (!definition?.name || !definition?.description || !definition?.category || !definition?.settings || !Array.isArray(definition.channels)) throw new Error('The AI service returned an incomplete template. Please try again.');
  const allowedTypes=new Set(['category','text','announcement','forum','voice','stage']);
  definition.roles=definition.roles.filter(r=>r&&typeof r.name==='string').slice(0,50).map(r=>({name:String(r.name).slice(0,100),color:/^#[0-9a-f]{6}$/i.test(String(r.color||''))?String(r.color).toUpperCase():'#000000',hoist:Boolean(r.hoist),mentionable:Boolean(r.mentionable)}));
  definition.channels=definition.channels.filter(ch=>ch&&typeof ch.name==='string'&&allowedTypes.has(ch.type)).slice(0,50).map(ch=>({name:String(ch.name).slice(0,100),type:ch.type,category:ch.category==null?null:String(ch.category).slice(0,100),topic:ch.topic==null?null:String(ch.topic).slice(0,1000)}));
  const created=db.createTemplate({ slug: slugify(`${name}-${Date.now()}`), name: definition.name, description: definition.description, category: definition.category, source: 'ai', status: 'draft', createdBy, creatorSlug: creatorSlug(createdBy, `creator-${String(createdBy).slice(-6)}`), definition, prompt: goal });
  return created;
}
function templateReactionRoles(definition){
  const input=definition?.settings?.reactionRoles;
  if(!input||!Array.isArray(input.roles)) return {enabled:false,title:'Choose your roles',description:'Select the roles that apply to you.',roles:[]};
  return {enabled:input.enabled!==false,title:String(input.title||'Choose your roles'),description:String(input.description||'Select the roles that apply to you.'),roles:input.roles.slice(0,25).map(r=>({label:String(r.label),emoji:r.emoji?String(r.emoji):null,roleName:String(r.roleName),description:r.description?String(r.description):null}))};
}
function list(status=null){return db.listTemplates(status,50);}
function publishTemplate(id,reviewerId){
  const t=db.getTemplate(id);
  if(!t || t.status==='published') return t;
  if(!['ai','community'].includes(t.source)) return t;
  db.updateTemplateStatus(id,'published');
  if(t.source==='community') db.grantContributorDays(t.created_by,3,'template',reviewerId,String(t.id));
  return db.getTemplate(id);
}

function creatorSlug(userId, fallback='creator') {
  return slugify(String(fallback||'creator')).replace(/-+/g,'-').slice(0,40) || `creator-${String(userId).slice(-6)}`;
}
function hostedPath(template, creatorName=null) {
  const slug = template.creator_slug || creatorSlug(template.created_by, creatorName || `creator-${String(template.created_by).slice(-6)}`);
  return `/template/${slug}/${template.id}`;
}
function createPrivateCopy({sourceId,createdBy,creatorName}) {
  if (db.countPrivateTemplates(createdBy) >= 10) throw new Error('You have reached the 10 private template limit. Delete a private template before creating another.');
  const source=db.getTemplate(sourceId);
  if(!source || source.status!=='published') throw new Error('That template is not available to copy.');
  const definition=JSON.parse(source.definition_json||'{}');
  const created=db.createTemplate({slug:slugify(`${creatorName||'template'}-${source.name}-${Date.now()}`),name:source.name,description:source.description,category:source.category,source:'copy',status:'private',createdBy,creatorNote:'Private copy',creatorSlug:creatorSlug(createdBy,creatorName),definition,prompt:null});
  return created;
}
function setVisibility(id,visibility,changedBy) {
  const t=db.getTemplate(id); if(!t) throw new Error('Template not found.');
  if(String(t.created_by)!==String(changedBy)) throw new Error('Only the template creator can change its visibility.');
  if(visibility==='private' && t.status!=='private' && db.countPrivateTemplates(changedBy)>=10) throw new Error('You have reached the 10 private template limit.');
  if(!['private','unlisted'].includes(visibility)) throw new Error('Invalid template visibility.');
  return db.updateTemplateStatus(id,visibility);
}
function deletePrivate(id,userId){const t=db.getTemplate(id);if(!t||String(t.created_by)!==String(userId))throw new Error('Template not found.');if(t.status!=='private')throw new Error('Only private templates can be deleted.');db.db.prepare('DELETE FROM templates WHERE id=?').run(Number(id));return true;}
function versions(id){return db.listTemplateVersions(id,50);}
function serverLayoutText(template, versionNumber=null){
  if(!template) throw new Error('Template not found.');
  let definition={};
  try { definition=JSON.parse(template.definition_json||'{}'); } catch {}
  const roles=Array.isArray(definition.roles)?definition.roles:[];
  const channels=Array.isArray(definition.channels)?definition.channels:[];
  const settings=definition.settings&&typeof definition.settings==='object'?definition.settings:{};
  const version=versionNumber||template.version||1;
  const lines=[];
  lines.push('OXY SERVER TEMPLATE');
  lines.push('===================');
  lines.push('');
  lines.push(`Name: ${template.name}`);
  lines.push(`Creator: ${template.creator_slug||`creator-${String(template.created_by).slice(-6)}`}`);
  lines.push(`Template ID: ${template.id}`);
  lines.push(`Version: ${version}`);
  lines.push(`Category: ${template.category||'community'}`);
  lines.push('');
  lines.push('DESCRIPTION');
  lines.push('===========');
  lines.push(template.description||'No description provided.');
  lines.push('');
  lines.push('ROLES');
  lines.push('=====');
  if(!roles.length) lines.push('No roles included.');
  for(const r of roles){
    lines.push(`- ${r.name||'Unnamed role'}`);
    lines.push(`  Colour: ${r.color||'#000000'}`);
    lines.push(`  Hoisted: ${r.hoist?'Yes':'No'}`);
    lines.push(`  Mentionable: ${r.mentionable?'Yes':'No'}`);
  }
  lines.push('');
  lines.push('CHANNELS');
  lines.push('========');
  if(!channels.length) lines.push('No channels included.');
  for(const c of channels){
    lines.push(`- ${c.name||'Unnamed channel'}`);
    lines.push(`  Type: ${c.type||'text'}`);
    lines.push(`  Category: ${c.category||'None'}`);
    if(c.topic) lines.push(`  Topic: ${c.topic}`);
  }
  lines.push('');
  lines.push('SETTINGS');
  lines.push('========');
  for(const [key,value] of Object.entries(settings)){
    if(value && typeof value==='object'){
      lines.push(`${key}:`);
      for(const [k,v] of Object.entries(value)) lines.push(`  ${k}: ${Array.isArray(v)?v.join(', '):typeof v==='object'&&v!==null?JSON.stringify(v):String(v)}`);
    } else lines.push(`${key}: ${String(value)}`);
  }
  lines.push('');
  lines.push('Generated by Oxy Controller');
  return lines.join('\n');
}
function templateFilename(template,versionNumber=null){
  const clean=slugify(template?.name||'server-template').replace(/-/g,'-').slice(0,60)||'server-template';
  return `${clean}-v${versionNumber||template?.version||1}.txt`;
}

function grantCodeContributor(userId,devId){return db.grantContributorDays(userId,Number(process.env.CONTRIBUTOR_CODE_DAYS||30),'code',devId,null);}
function extractDiscordTemplateCode(input){
  const raw=String(input||'').trim();
  try {
    const u=new URL(raw);
    const host=u.hostname.toLowerCase();
    const path=u.pathname.replace(/^\/+|\/+$/g,'');
    if(host==='discord.new' || host==='www.discord.new') {
      const code=path.split('/')[0];
      return /^[A-Za-z0-9_-]+$/.test(code) ? code : null;
    }
    if(host==='discord.com' || host==='www.discord.com' || host==='discordapp.com' || host==='www.discordapp.com') {
      const parts=path.split('/');
      if(parts[0].toLowerCase()==='template' && /^[A-Za-z0-9_-]+$/.test(parts[1]||'')) return parts[1];
    }
  } catch {}
  return null;
}
async function submitDiscordTemplate({url,createdBy}){
  const code=extractDiscordTemplateCode(url);
  if(!code) throw new Error('Use a valid Discord template link such as https://discord.new/your-code.');
  for (const existing of db.listTemplates(null,100)) {
    try { if (JSON.parse(existing.definition_json||'{}')?.discordTemplate?.code === code) throw new Error('That Discord template has already been submitted to Oxy.'); } catch (e) { if (e.message.includes('already been submitted')) throw e; }
  }
  let response;
  try {
    response=await fetch(`https://discord.com/api/v10/guilds/templates/${encodeURIComponent(code)}`,{headers:{Accept:'application/json','User-Agent':'Oxy-Controller/0.4.13'},signal:AbortSignal.timeout(10000)});
  } catch {
    throw new Error('Oxy could not reach Discord to verify that template. Please try again.');
  }
  if(!response.ok) {
    if(response.status===404) throw new Error('That Discord template could not be found or is no longer available.');
    if(response.status===429) throw new Error('Discord is temporarily rate limiting template checks. Please try again shortly.');
    throw new Error(`Discord could not verify that template (${response.status}).`);
  }
  const data=await response.json();
  if(!data?.code||!data?.name) throw new Error('Discord returned an invalid template.');
  const definition={discordTemplate:{code:String(data.code),url:`https://discord.new/${data.code}`,name:String(data.name),description:String(data.description||''),usageCount:Number(data.usage_count||0),createdAt:data.created_at||null,updatedAt:data.updated_at||null}};
  const created=db.createTemplate({slug:slugify(`discord-${data.code}-${Date.now()}`),name:String(data.name),description:String(data.description||'Discord server template submitted by the community.'),category:'community',source:'community',status:'pending',createdBy,creatorSlug:creatorSlug(createdBy, `creator-${String(createdBy).slice(-6)}`),definition,prompt:`Discord template: https://discord.new/${data.code}`});
  return created;
}
function discordTemplate(definition){return definition?.discordTemplate||null;}
module.exports={canCreate,generate,submitDiscordTemplate,extractDiscordTemplateCode,discordTemplate,list,publishTemplate,grantCodeContributor,templateReactionRoles,hostedPath,createPrivateCopy,setVisibility,deletePrivate,versions,serverLayoutText,templateFilename};
