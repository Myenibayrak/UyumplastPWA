"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import type { Definition, SystemSetting } from "@/lib/types";
import { ROLE_LABELS, type AppRole } from "@/lib/types";

interface FeatureFlag { id: string; flag: string; enabled: boolean; description: string | null }
interface NotifTemplate { id: string; event_type: string; title_template: string; body_template: string; active: boolean }
interface WorkflowSetting { id: string; name: string; config: Record<string, unknown>; description: string | null; active: boolean }

export function SettingsPanel() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [permissions, setPermissions] = useState<Array<{ id: string; role: AppRole; permission: string; allowed: boolean }>>([]);
  const [fieldVis, setFieldVis] = useState<Array<{ id: string; table_name: string; field_name: string; roles: AppRole[]; visible: boolean }>>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [templates, setTemplates] = useState<NotifTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSetting[]>([]);
  const [newDef, setNewDef] = useState({ category: "", label: "", value: "" });

  const loadAll = useCallback(async () => {
    const supabase = createClient();
    const [s, d, p, f, fl, t, w] = await Promise.all([
      supabase.from("system_settings").select("*").order("key"),
      supabase.from("definitions").select("*").order("category").order("sort_order"),
      supabase.from("role_permissions").select("*").order("role").order("permission"),
      supabase.from("field_visibility").select("*").order("table_name").order("field_name"),
      supabase.from("feature_flags").select("*").order("flag"),
      supabase.from("notification_templates").select("*").order("event_type"),
      supabase.from("workflow_settings").select("*").order("name"),
    ]);
    if (s.data) setSettings(s.data as SystemSetting[]);
    if (d.data) setDefinitions(d.data as Definition[]);
    if (p.data) setPermissions(p.data as typeof permissions);
    if (f.data) setFieldVis(f.data as typeof fieldVis);
    if (fl.data) setFlags(fl.data as FeatureFlag[]);
    if (t.data) setTemplates(t.data as NotifTemplate[]);
    if (w.data) setWorkflows(w.data as WorkflowSetting[]);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveSetting(key: string, value: string) {
    const supabase = createClient();
    const { error } = await supabase.from("system_settings").update({ value }).eq("key", key);
    if (error) toast({ title: "Hata", description: error.message, variant: "destructive" });
    else toast({ title: "Kaydedildi" });
  }

  async function addDefinition() {
    if (!newDef.category || !newDef.label) return;
    const supabase = createClient();
    const { error } = await supabase.from("definitions").insert({
      category: newDef.category,
      label: newDef.label,
      value: newDef.value || newDef.label.toLowerCase().replace(/\s+/g, "_"),
      sort_order: definitions.filter((d) => d.category === newDef.category).length + 1,
    });
    if (error) toast({ title: "Hata", description: error.message, variant: "destructive" });
    else { toast({ title: "Eklendi" }); setNewDef({ category: "", label: "", value: "" }); loadAll(); }
  }

  async function deleteDefinition(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("definitions").delete().eq("id", id);
    if (error) toast({ title: "Hata", variant: "destructive" });
    else { toast({ title: "Silindi" }); loadAll(); }
  }

  async function togglePermission(id: string, allowed: boolean) {
    const supabase = createClient();
    const { error } = await supabase.from("role_permissions").update({ allowed }).eq("id", id);
    if (error) toast({ title: "Hata", variant: "destructive" });
    else loadAll();
  }

  async function toggleFlag(id: string, enabled: boolean) {
    const supabase = createClient();
    const { error } = await supabase.from("feature_flags").update({ enabled }).eq("id", id);
    if (error) toast({ title: "Hata", variant: "destructive" });
    else loadAll();
  }

  async function saveTemplate(id: string, title: string, body: string) {
    const supabase = createClient();
    const { error } = await supabase.from("notification_templates").update({ title_template: title, body_template: body }).eq("id", id);
    if (error) toast({ title: "Hata", variant: "destructive" });
    else toast({ title: "Kaydedildi" });
  }

  const categories = Array.from(new Set(definitions.map((d) => d.category)));

  return (
    <Tabs defaultValue="general" className="space-y-4">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="general">Genel</TabsTrigger>
        <TabsTrigger value="definitions">Tanımlar</TabsTrigger>
        <TabsTrigger value="permissions">İzinler</TabsTrigger>
        <TabsTrigger value="fields">Alan Görünürlüğü</TabsTrigger>
        <TabsTrigger value="workflows">İş Akışları</TabsTrigger>
        <TabsTrigger value="notifications">Bildirim Şablonları</TabsTrigger>
        <TabsTrigger value="flags">Özellik Bayrakları</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <Card>
          <CardHeader><CardTitle>Sistem Ayarları</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {settings.map((s) => (
              <div key={s.key} className="flex items-end gap-4">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs font-semibold">{s.key}</Label>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  <Input
                    defaultValue={s.value}
                    className="h-8"
                    onBlur={(e) => { if (e.target.value !== s.value) saveSetting(s.key, e.target.value); }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="definitions">
        <Card>
          <CardHeader><CardTitle>Tanımlar (Müşteri, Ürün Tipi, Birim, vb.)</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">Kategori</Label>
                <Input className="h-8 w-32" value={newDef.category} onChange={(e) => setNewDef((p) => ({ ...p, category: e.target.value }))} placeholder="customer" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Etiket</Label>
                <Input className="h-8 w-32" value={newDef.label} onChange={(e) => setNewDef((p) => ({ ...p, label: e.target.value }))} placeholder="Müşteri D" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Değer</Label>
                <Input className="h-8 w-32" value={newDef.value} onChange={(e) => setNewDef((p) => ({ ...p, value: e.target.value }))} placeholder="musteri_d" />
              </div>
              <Button onClick={addDefinition} size="sm" className="h-8"><Plus className="h-3 w-3 mr-1" /> Ekle</Button>
            </div>

            {categories.map((cat) => (
              <div key={cat}>
                <h3 className="font-semibold mb-2 capitalize text-sm">{cat}</h3>
                <div className="space-y-1">
                  {definitions.filter((d) => d.category === cat).map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-2 rounded border text-sm">
                      <div>
                        <span className="font-medium">{d.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">({d.value})</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteDefinition(d.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="permissions">
        <Card>
          <CardHeader><CardTitle>Rol İzinleri</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {permissions.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded border text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[p.role]}</Badge>
                    <span>{p.permission}</span>
                  </div>
                  <Button
                    variant={p.allowed ? "default" : "outline"}
                    size="sm" className="h-6 text-xs"
                    onClick={() => togglePermission(p.id, !p.allowed)}
                  >
                    {p.allowed ? "✓ Aktif" : "✗ Pasif"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="fields">
        <Card>
          <CardHeader><CardTitle>Alan Görünürlüğü</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {fieldVis.map((f) => (
                <div key={f.id} className="p-3 rounded border space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{f.table_name}.{f.field_name}</span>
                    <Badge variant={f.visible ? "default" : "destructive"} className="text-[10px]">
                      {f.visible ? "Görünür" : "Gizli"}
                    </Badge>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {f.roles.map((r) => (
                      <Badge key={r} variant="secondary" className="text-[10px]">{ROLE_LABELS[r]}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="workflows">
        <Card>
          <CardHeader><CardTitle>İş Akışları</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {workflows.map((w) => (
              <div key={w.id} className="p-4 rounded border space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">{w.name}</h4>
                  <Badge variant={w.active ? "default" : "secondary"}>{w.active ? "Aktif" : "Pasif"}</Badge>
                </div>
                {w.description && <p className="text-xs text-muted-foreground">{w.description}</p>}
                <div className="text-xs">
                  <Label className="text-xs font-semibold">Durumlar:</Label>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {((w.config as Record<string, unknown>)?.statuses as string[] || []).map((s: string) => (
                      <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {workflows.length === 0 && <p className="text-sm text-muted-foreground">İş akışı tanımlanmamış</p>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="notifications">
        <Card>
          <CardHeader><CardTitle>Bildirim Şablonları</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {templates.map((t) => (
              <div key={t.id} className="p-4 rounded border space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{t.event_type}</Badge>
                  <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Aktif" : "Pasif"}</Badge>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Başlık Şablonu</Label>
                  <Input
                    className="h-8 text-sm"
                    defaultValue={t.title_template}
                    onBlur={(e) => saveTemplate(t.id, e.target.value, t.body_template)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">İçerik Şablonu</Label>
                  <Textarea
                    className="text-sm min-h-[40px]"
                    defaultValue={t.body_template}
                    onBlur={(e) => saveTemplate(t.id, t.title_template, e.target.value)}
                  />
                </div>
              </div>
            ))}
            {templates.length === 0 && <p className="text-sm text-muted-foreground">Şablon tanımlanmamış</p>}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="flags">
        <Card>
          <CardHeader><CardTitle>Özellik Bayrakları</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {flags.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-3 rounded border">
                  <div>
                    <span className="font-medium text-sm">{f.flag}</span>
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                  <Button
                    variant={f.enabled ? "default" : "outline"}
                    size="sm" className="h-7 text-xs min-w-[60px]"
                    onClick={() => toggleFlag(f.id, !f.enabled)}
                  >
                    {f.enabled ? "Açık" : "Kapalı"}
                  </Button>
                </div>
              ))}
              {flags.length === 0 && <p className="text-sm text-muted-foreground">Özellik bayrağı yok</p>}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
