"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Save, Plus, Trash2 } from "lucide-react";
import type { Definition, SystemSetting } from "@/lib/types";
import { APP_ROLES, ROLE_LABELS, type AppRole } from "@/lib/types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [permissions, setPermissions] = useState<Array<{ id: string; role: AppRole; permission: string; allowed: boolean }>>([]);
  const [fieldVis, setFieldVis] = useState<Array<{ id: string; table_name: string; field_name: string; roles: AppRole[]; visible: boolean }>>([]);
  const [newDef, setNewDef] = useState({ category: "", label: "", value: "" });
  const supabase = createClient();

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    const [s, d, p, f] = await Promise.all([
      supabase.from("system_settings").select("*").order("key"),
      supabase.from("definitions").select("*").order("category").order("sort_order"),
      supabase.from("role_permissions").select("*").order("role").order("permission"),
      supabase.from("field_visibility").select("*").order("table_name").order("field_name"),
    ]);
    if (s.data) setSettings(s.data as SystemSetting[]);
    if (d.data) setDefinitions(d.data as Definition[]);
    if (p.data) setPermissions(p.data as Array<{ id: string; role: AppRole; permission: string; allowed: boolean }>);
    if (f.data) setFieldVis(f.data as Array<{ id: string; table_name: string; field_name: string; roles: AppRole[]; visible: boolean }>);
  }

  async function saveSetting(key: string, value: string) {
    const { error } = await supabase.from("system_settings").update({ value }).eq("key", key);
    if (error) toast({ title: "Hata", description: error.message, variant: "destructive" });
    else toast({ title: "Kaydedildi" });
  }

  async function addDefinition() {
    if (!newDef.category || !newDef.label) return;
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
    const { error } = await supabase.from("definitions").delete().eq("id", id);
    if (error) toast({ title: "Hata", description: error.message, variant: "destructive" });
    else { toast({ title: "Silindi" }); loadAll(); }
  }

  async function togglePermission(id: string, allowed: boolean) {
    const { error } = await supabase.from("role_permissions").update({ allowed }).eq("id", id);
    if (error) toast({ title: "Hata", description: error.message, variant: "destructive" });
    else { toast({ title: "Güncellendi" }); loadAll(); }
  }

  const categories = Array.from(new Set(definitions.map((d) => d.category)));

  return (
    <Tabs defaultValue="general" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="general">Genel</TabsTrigger>
        <TabsTrigger value="definitions">Tanımlar</TabsTrigger>
        <TabsTrigger value="permissions">İzinler</TabsTrigger>
        <TabsTrigger value="fields">Alan Görünürlüğü</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <Card>
          <CardHeader><CardTitle>Sistem Ayarları</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {settings.map((s) => (
              <div key={s.key} className="flex items-end gap-4">
                <div className="flex-1 space-y-1">
                  <Label>{s.key}</Label>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  <Input
                    defaultValue={s.value}
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
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label>Kategori</Label>
                <Input value={newDef.category} onChange={(e) => setNewDef((p) => ({ ...p, category: e.target.value }))} placeholder="customer" />
              </div>
              <div className="space-y-1">
                <Label>Etiket</Label>
                <Input value={newDef.label} onChange={(e) => setNewDef((p) => ({ ...p, label: e.target.value }))} placeholder="Müşteri D" />
              </div>
              <div className="space-y-1">
                <Label>Değer</Label>
                <Input value={newDef.value} onChange={(e) => setNewDef((p) => ({ ...p, value: e.target.value }))} placeholder="musteri_d" />
              </div>
              <Button onClick={addDefinition} size="sm"><Plus className="h-4 w-4 mr-1" /> Ekle</Button>
            </div>

            {categories.map((cat) => (
              <div key={cat}>
                <h3 className="font-semibold mb-2 capitalize">{cat}</h3>
                <div className="space-y-1">
                  {definitions.filter((d) => d.category === cat).map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-2 rounded border">
                      <div>
                        <span className="font-medium">{d.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">({d.value})</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteDefinition(d.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
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
            <div className="space-y-2">
              {permissions.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded border">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{ROLE_LABELS[p.role]}</Badge>
                    <span className="text-sm">{p.permission}</span>
                  </div>
                  <Button
                    variant={p.allowed ? "default" : "outline"}
                    size="sm"
                    onClick={() => togglePermission(p.id, !p.allowed)}
                  >
                    {p.allowed ? "Aktif" : "Pasif"}
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
                    <span className="font-medium">{f.table_name}.{f.field_name}</span>
                    <Badge variant={f.visible ? "success" : "destructive"}>
                      {f.visible ? "Görünür" : "Gizli"}
                    </Badge>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {f.roles.map((r) => (
                      <Badge key={r} variant="secondary">{ROLE_LABELS[r]}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
