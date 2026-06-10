import { createContext, useContext, useState, type ReactNode } from "react";
import { getPref, setPref } from "./localStore";

// UI language. Portuguese strings follow European Portuguese (pt-PT) norms:
// "guardar" (not "salvar"), "utilizadores", "a + infinitivo" progressives,
// AO90 spellings ("detetar", "afetado", "fator").
export type Lang = "en" | "pt";

export const LOCALES: Record<Lang, string> = { en: "en-GB", pt: "pt-PT" };

const en = {
  // Intro / location gate
  tagline: "Dialing in on sunny times.",
  pitch: "Other apps show you the forecast. Solara scores it for people who need the sun.",
  superman1: "This app was designed for Superman. He absorbs sun radiation and uses it for his daily hero activities.",
  superman2: "All others using it should exercise caution and heed health authorities’ recommendations on sun exposure.",
  getStarted: "Get started",
  aboutScore: "About the score",
  searchPlaceholder: "Search city — e.g. Évora, Lisboa…",
  searching: "Searching…",
  or: "or",
  useGps: "Use my GPS location",
  detecting: "Detecting…",
  gpsError: "GPS unavailable — please search for your city above.",
  privacyNote: "Location is only used to fetch weather. Nothing is stored.",
  savedPlaces: "saved places",

  // Header / main
  toggleUnits: "Toggle units",
  solaraIndex: "Solara Index",
  langButtonTitle: "Mudar para português",
  loadError: "Could not load weather data.",
  tryAgain: "Try again",
  today: "Today",

  // Hour row
  feelsLike: (t: string) => `${t} feels-like`,
  actualTemp: (t: string) => `(${t} actual)`,
  titleRadiation: "Direct radiation (W/m²)",
  titleCloud: "Cloud cover",
  titleUV: "UV Index",
  titleFeels: "Feels-like temperature",
  titleWind: "Wind speed",

  // Favourites
  save: "Save",

  // Accuracy section
  accuracyTitle: "Forecast accuracy — past 7 days",
  accuracyError: "Could not load historical data.",
  bestHour: "best hour:",
  forecast: "forecast",
  actual: "actual",
  fcstShort: "fcst",
  actualShort: "actual",
  colRad: "⚡ Rad",
  colCloud: "☁ Cloud",
  colUV: "☀ UV",
  colTemp: "🌡 Temp",
  colWind: "🌬 Wind",
  accuracyFootnote: "Forecast: Open-Meteo forecast model · Actual: ERA5 reanalysis archive · Delta = actual − forecast",

  // Footer
  weatherLabel: "Weather:",
  createdWith: "Created with Perplexity Computer",

  // About panel
  about: {
    title: "Solara Index",
    scoreLabelsTitle: "Score labels",
    scoreLabelsIntro: "Each daylight hour is scored 0–100. The score reflects the big star’s potential to power Superman and normal people.",
    scoreLabels: [
      { label: "Prime sun", range: "80–100", desc: "Everything aligned. Peak radiation, strong UV, warm, low wind. The star is performing. Rare outside summer." },
      { label: "Good sun", range: "65–79", desc: "Solid across all variables. This is what you came for." },
      { label: "Fair sun", range: "45–64", desc: "Something is holding it back — cold air, partial cloud, or wind. Still worth it." },
      { label: "Weak sun", range: "25–44", desc: "Marginal. A clear January noon or a warm overcast afternoon. The star is trying." },
      { label: "No sun", range: "0–24", desc: "Overcast, rainy, or night. Nothing to score here." },
    ],
    howBuiltTitle: "How the score is built",
    howBuiltIntro: "Four variables add up, then wind scales the result. The star provides the inputs. Wind decides if you’ll stay long enough to benefit.",
    maxLabel: "max",
    variables: [
      { name: "Solar radiation", weight: "45 pts", detail: "Direct W/m² reaching the ground. The heaviest term — it physically encodes cloud conditions and sun angle. Above 500 W/m² a saturation curve applies, compressing the top end so peak summer doesn't dominate." },
      { name: "Cloud cover", weight: "15 pts", detail: "Lower weight than radiation — cloud’s effect is already in the radiation number. This term catches the partial coverage radiation misses." },
      { name: "UV index", weight: "15 pts", detail: "Scored 0–10. When the forecast API returns nothing, Solara estimates it from radiation and solar angle with a seasonal factor." },
      { name: "Feels-like temperature", weight: "25 pts", detail: "Below 10°C the term is zero — not because the star stopped, but because normal people won’t expose enough skin to benefit. Superman is unaffected." },
    ],
    windTitle: "🌬 Wind multiplier",
    windSub: "scales the entire base score",
    windBody: "Wind doesn't block UV — but it determines whether you'll actually stay outside. The multiplier is continuous, not stepped: penalties increase smoothly with speed.",
    windRows: [
      { range: "≤ 15 km/h", label: "No penalty", mult: "×1.0", note: "Calm to gentle breeze. Beaufort 0–3." },
      { range: "15–30 km/h", label: "Mild penalty", mult: "×1.0→0.7", note: "Moderate breeze. Noticeable but manageable." },
      { range: "30–50 km/h", label: "Strong penalty", mult: "×0.7→0.4", note: "Fresh to strong breeze. Extended stays unlikely." },
      { range: "> 50 km/h", label: "Severe", mult: "×0.3", note: "Near gale. Most people will not stay out." },
    ],
    correctionsTitle: "Automatic corrections",
    correctionsIntro: "Weather models have known blind spots. Solara corrects for three of them, automatically.",
    nortadaTitle: "Nortada wind (IPCJ)",
    nortadaP1: "ERA5 — the model behind Open-Meteo — runs at ~31 km resolution and systematically underestimates the Iberian Coastal Low-Level Jet (the Nortada), a persistent northerly along Portugal's Atlantic coast present on ~70% of summer days, with model underestimates of 7–14 km/h at the coast. (Soares et al., 2014; DIVA-Portal 2014)",
    nortadaP2a: "Solara classifies each location automatically and multiplies the reported wind before scoring. The corrected value appears as ",
    nortadaP2b: " in each hour row and in the accuracy board.",
    tiers: [
      { tier: "High exposure", desc: "West-Atlantic-facing beaches directly in the jet path: Costa Vicentina, Nazaré, Figueira, Costa Nova, Praia de Mira, Costa da Caparica, Guincho, Ofir, Matosinhos." },
      { tier: "Medium exposure", desc: "Partially sheltered: Arrábida, Sesimbra, Tróia, southwest tip (Sagres area)." },
      { tier: "No correction", desc: "Algarve south coast, Madeira, Açores, inland locations." },
    ],
    tableSeason: "Season",
    tableHours: "Hours",
    tableHigh: "High",
    tableMedium: "Medium",
    tableRows: [
      { season: "Jun–Sep", hours: "13h–20h", high: "×1.40", med: "×1.25" },
      { season: "Jun–Sep", hours: "07h–12h", high: "×1.15", med: "×1.10" },
      { season: "Jun–Sep", hours: "other", high: "×1.10", med: "×1.05" },
      { season: "Apr–May, Oct", hours: "13h–20h", high: "×1.20", med: "×1.12" },
      { season: "Apr–May, Oct", hours: "other", high: "×1.10", med: "×1.05" },
      { season: "Nov–Mar", hours: "any", high: "×1.05", med: "×1.02" },
    ],
    saturationTitle: "Radiation saturation",
    saturationBody: "600 vs 750 W/m² feels the same to a normal person. A linear model over-rewards peak summer. Above 500 W/m² Solara compresses the range with a square-root curve, so 800 W/m² maps to ~680 effective W/m².",
    uvFallbackTitle: "UV fallback estimate",
    uvFallbackBody: "Open-Meteo's forecast API sometimes returns null UV. When that happens, Solara estimates UV from direct radiation using a zenith-angle weight (peaks at solar noon) and a seasonal efficiency factor — summer ozone over Iberia is thinner, yielding more UV per W/m².",
    dataSource1: "Weather data from ",
    dataSource2: " (ERA5-backed forecast and archive APIs). Location search via ",
    dataSource3: ". Wind correction: Soares et al., 2014, Univ. Lisbon; DIVA-Portal IPCJ Climatology, 2014.",
  },
};

const pt: typeof en = {
  // Intro / location gate
  tagline: "Momentos soalheiros.",
  pitch: "As outras aplicações mostram-lhe a previsão. O Solara classifica-a para quem precisa do sol.",
  superman1: "Esta aplicação foi concebida para o Super-Homem. Ele absorve a radiação solar e usa-a nas suas atividades heroicas do dia a dia.",
  superman2: "Todos os outros utilizadores devem ter cuidado e seguir as recomendações das autoridades de saúde sobre exposição solar.",
  getStarted: "Começar",
  aboutScore: "Sobre o índice",
  searchPlaceholder: "Pesquisar cidade — ex.: Évora, Lisboa…",
  searching: "A pesquisar…",
  or: "ou",
  useGps: "Usar a minha localização GPS",
  detecting: "A detetar…",
  gpsError: "GPS indisponível — pesquise a sua cidade acima.",
  privacyNote: "A localização é usada apenas para obter a meteorologia. Nada fica guardado.",
  savedPlaces: "locais guardados",

  // Header / main
  toggleUnits: "Mudar unidades",
  solaraIndex: "Índice Solara",
  langButtonTitle: "Switch to English",
  loadError: "Não foi possível carregar os dados meteorológicos.",
  tryAgain: "Tentar novamente",
  today: "Hoje",

  // Hour row
  feelsLike: (t: string) => `sensação ${t}`,
  actualTemp: (t: string) => `(real: ${t})`,
  titleRadiation: "Radiação direta (W/m²)",
  titleCloud: "Nebulosidade",
  titleUV: "Índice UV",
  titleFeels: "Sensação térmica",
  titleWind: "Velocidade do vento",

  // Favourites
  save: "Guardar",

  // Accuracy section
  accuracyTitle: "Precisão da previsão — últimos 7 dias",
  accuracyError: "Não foi possível carregar os dados históricos.",
  bestHour: "melhor hora:",
  forecast: "previsão",
  actual: "real",
  fcstShort: "prev.",
  actualShort: "real",
  colRad: "⚡ Rad",
  colCloud: "☁ Nuvens",
  colUV: "☀ UV",
  colTemp: "🌡 Temp",
  colWind: "🌬 Vento",
  accuracyFootnote: "Previsão: modelo de previsão Open-Meteo · Real: arquivo de reanálise ERA5 · Delta = real − previsão",

  // Footer
  weatherLabel: "Meteorologia:",
  createdWith: "Criado com o Perplexity Computer",

  // About panel
  about: {
    title: "Índice Solara",
    scoreLabelsTitle: "Níveis de pontuação",
    scoreLabelsIntro: "Cada hora de luz do dia recebe uma pontuação de 0 a 100. A pontuação reflete o potencial da grande estrela para dar energia ao Super-Homem e às pessoas normais.",
    scoreLabels: [
      { label: "Sol de luxo", range: "80–100", desc: "Tudo alinhado. Radiação no pico, UV forte, calor, pouco vento. A estrela está em grande forma. Raro fora do verão." },
      { label: "Bom sol", range: "65–79", desc: "Sólido em todas as variáveis. É disto que estava à procura." },
      { label: "Sol razoável", range: "45–64", desc: "Algo o está a travar — ar frio, nuvens parciais ou vento. Ainda assim, vale a pena." },
      { label: "Sol fraco", range: "25–44", desc: "Marginal. Um meio-dia limpo de janeiro ou uma tarde quente e encoberta. A estrela está a esforçar-se." },
      { label: "Sem sol", range: "0–24", desc: "Encoberto, chuva ou noite. Nada para pontuar." },
    ],
    howBuiltTitle: "Como se constrói a pontuação",
    howBuiltIntro: "Quatro variáveis somam-se e, no fim, o vento ajusta o resultado. A estrela fornece os dados. O vento decide se fica lá fora tempo suficiente para tirar proveito.",
    maxLabel: "máx.",
    variables: [
      { name: "Radiação solar", weight: "45 pts", detail: "W/m² diretos a chegar ao solo. O termo com mais peso — codifica fisicamente a nebulosidade e o ângulo do sol. Acima de 500 W/m² aplica-se uma curva de saturação que comprime os valores mais altos, para que o pico do verão não domine." },
      { name: "Nebulosidade", weight: "15 pts", detail: "Peso menor do que a radiação — o efeito das nuvens já está incluído no valor da radiação. Este termo apanha a cobertura parcial que escapa à radiação." },
      { name: "Índice UV", weight: "15 pts", detail: "Pontuado de 0 a 10. Quando a API de previsão não devolve nada, o Solara estima-o a partir da radiação e do ângulo solar, com um fator sazonal." },
      { name: "Sensação térmica", weight: "25 pts", detail: "Abaixo de 10 °C este termo vale zero — não porque a estrela tenha parado, mas porque as pessoas normais não expõem pele suficiente para tirar proveito. O Super-Homem não é afetado." },
    ],
    windTitle: "🌬 Multiplicador de vento",
    windSub: "ajusta toda a pontuação base",
    windBody: "O vento não bloqueia os UV — mas determina se realmente fica lá fora. O multiplicador é contínuo, não por patamares: as penalizações aumentam suavemente com a velocidade.",
    windRows: [
      { range: "≤ 15 km/h", label: "Sem penalização", mult: "×1.0", note: "Calmaria a brisa leve. Beaufort 0–3." },
      { range: "15–30 km/h", label: "Penalização ligeira", mult: "×1.0→0.7", note: "Brisa moderada. Nota-se, mas aguenta-se." },
      { range: "30–50 km/h", label: "Penalização forte", mult: "×0.7→0.4", note: "Brisa fresca a forte. Estadias prolongadas são improváveis." },
      { range: "> 50 km/h", label: "Severa", mult: "×0.3", note: "Quase vendaval. A maioria das pessoas não fica na rua." },
    ],
    correctionsTitle: "Correções automáticas",
    correctionsIntro: "Os modelos meteorológicos têm pontos cegos conhecidos. O Solara corrige três deles, automaticamente.",
    nortadaTitle: "Vento de nortada (IPCJ)",
    nortadaP1: "O ERA5 — o modelo por detrás do Open-Meteo — corre a uma resolução de ~31 km e subestima sistematicamente o jato costeiro ibérico de baixos níveis (a nortada), um vento norte persistente ao longo da costa atlântica portuguesa, presente em ~70% dos dias de verão, com subestimações de 7–14 km/h junto à costa. (Soares et al., 2014; DIVA-Portal 2014)",
    nortadaP2a: "O Solara classifica cada local automaticamente e multiplica o vento reportado antes de pontuar. O valor corrigido aparece como ",
    nortadaP2b: " em cada linha horária e no painel de precisão.",
    tiers: [
      { tier: "Exposição elevada", desc: "Praias viradas a oeste para o Atlântico, diretamente no caminho do jato: Costa Vicentina, Nazaré, Figueira, Costa Nova, Praia de Mira, Costa da Caparica, Guincho, Ofir, Matosinhos." },
      { tier: "Exposição média", desc: "Parcialmente abrigadas: Arrábida, Sesimbra, Tróia, ponta sudoeste (zona de Sagres)." },
      { tier: "Sem correção", desc: "Costa sul do Algarve, Madeira, Açores e locais do interior." },
    ],
    tableSeason: "Estação",
    tableHours: "Horas",
    tableHigh: "Alta",
    tableMedium: "Média",
    tableRows: [
      { season: "jun–set", hours: "13h–20h", high: "×1.40", med: "×1.25" },
      { season: "jun–set", hours: "07h–12h", high: "×1.15", med: "×1.10" },
      { season: "jun–set", hours: "outras", high: "×1.10", med: "×1.05" },
      { season: "abr–mai, out", hours: "13h–20h", high: "×1.20", med: "×1.12" },
      { season: "abr–mai, out", hours: "outras", high: "×1.10", med: "×1.05" },
      { season: "nov–mar", hours: "todas", high: "×1.05", med: "×1.02" },
    ],
    saturationTitle: "Saturação da radiação",
    saturationBody: "Para uma pessoa normal, 600 ou 750 W/m² sabem ao mesmo. Um modelo linear recompensa em excesso o pico do verão. Acima de 500 W/m², o Solara comprime a escala com uma curva de raiz quadrada, pelo que 800 W/m² correspondem a ~680 W/m² efetivos.",
    uvFallbackTitle: "Estimativa de UV de recurso",
    uvFallbackBody: "A API de previsão do Open-Meteo devolve, por vezes, UV nulo. Quando isso acontece, o Solara estima o UV a partir da radiação direta, com um peso pelo ângulo zenital (máximo ao meio-dia solar) e um fator de eficiência sazonal — no verão, o ozono sobre a Península Ibérica é mais fino, o que rende mais UV por W/m².",
    dataSource1: "Dados meteorológicos do ",
    dataSource2: " (APIs de previsão e arquivo baseadas no ERA5). Pesquisa de locais via ",
    dataSource3: ". Correção do vento: Soares et al., 2014, Univ. de Lisboa; DIVA-Portal IPCJ Climatology, 2014.",
  },
};

export type Strings = typeof en;
export const STRINGS: Record<Lang, Strings> = { en, pt };

interface LangContextValue {
  lang: Lang;
  locale: string;
  s: Strings;
  toggleLang: () => void;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = getPref("lang");
    if (saved === "pt" || saved === "en") return saved;
    return navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
  });

  const toggleLang = () => {
    setLang(prev => {
      const next: Lang = prev === "en" ? "pt" : "en";
      setPref("lang", next);
      return next;
    });
  };

  return (
    <LangContext.Provider value={{ lang, locale: LOCALES[lang], s: STRINGS[lang], toggleLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}

// Small pill button used in the header and on the entry screens.
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, toggleLang, s } = useLang();
  return (
    <button
      data-testid="btn-toggle-lang"
      onClick={toggleLang}
      title={s.langButtonTitle}
      className={`text-xs font-medium text-muted-foreground hover:text-foreground
        transition-colors px-2 py-1 rounded-lg hover:bg-accent ${className}`}
    >
      {lang === "en" ? "PT" : "EN"}
    </button>
  );
}
