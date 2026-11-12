// /lib/electronica-lecciones-s11-12.js
// Lecciones y resúmenes de las semanas 11 y 12 (envíos 31 a 36). Formato: ver lib/electronica-lecciones.js.
import { flujo } from './electronica-svg.js';

export const LECCIONES_S1112 = {

31: {
  titulo: 'Lección 21 · Consumo anómalo y fallas de encendido: un método de diagnóstico',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Reemplazar piezas al azar no es reparar. Hoy reunimos todo lo aprendido en un método ordenado: del síntoma a la hipótesis, de la hipótesis a la medición y de la medición a la conclusión.'] },
    { t: 'Definición técnica', p: ['El **diagnóstico sistemático** es un proceso que parte del síntoma observado, formula hipótesis, las contrasta con mediciones y concluye cuál es la causa raíz antes de intervenir. El **consumo** que muestra la fuente de laboratorio es una de las primeras pistas.'] },
    { t: 'Explicación sencilla', p: ['Una secuencia de trabajo razonable:',
      '1) **Entrevista**: qué ocurrió (golpe, líquido, cargador distinto, actualización de BIOS).',
      '2) **Inspección visual** con microscopio: corrosión, quemaduras, conector de carga, pines doblados.',
      '3) **Mediciones sin energía**: resistencia o modo diodo en las líneas principales contra GND, comparando con una placa buena del mismo modelo.',
      '4) **Energizar con la fuente** y límite de corriente, y observar el consumo.',
      '5) **Hipótesis según el consumo**: sin consumo, consumo bajo y estable, consumo alto o pegado al límite, o consumo que sube y baja (la placa intenta arrancar y se detiene).',
      '6) **Medir rails y señales** siguiendo la secuencia, apoyándose en esquema y boardview.',
      '7) **Reparar, verificar y documentar** cada medición y cada cambio.',
      'No existen números universales para el consumo: la referencia es la experiencia con el **mismo modelo**.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Un equipo no consume nada al conectarlo: la hipótesis más razonable es que no hay camino de energía (cargador, conector, protección o MOSFET de entrada). Un equipo con consumo alto fijo: sospecha de un cortocircuito (lo vemos el miércoles). Un equipo que sube y baja: algo se activa y se detiene; se busca la primera etapa que no confirma (PGOOD, EN).'] }
  ],
  svg: flujo(['Síntoma', 'Inspección|visual', 'Medición|sin energía', 'Fuente|con límite', 'Rails y|señales', 'Reparar y|documentar'], 'Un método ordenado evita cambiar piezas al azar'),
  svgPie: 'Diagrama ilustrativo de un método de trabajo general.',
  foto: 'Fotografía de referencia pendiente: puesto de trabajo con fuente regulable y placa en prueba (Wikimedia Commons). Registrar autor y licencia.',
  preguntas: [{ q: 'Un equipo no consume nada al conectarlo: ¿qué hipótesis formularías?', a: 'Que no hay camino de energía: cargador, conector, protecciones o MOSFET de entrada. Se mide la tensión en cada tramo hasta encontrar dónde desaparece.' }],
  resumen: 'Un buen diagnóstico va del síntoma a la hipótesis y a la medición, apoyado en el consumo que marca la fuente y documentando cada paso.',
  seguridad: 'Configura el límite de corriente antes de energizar. Si algo se calienta o huele a quemado, desconecta de inmediato.'
},

32: {
  titulo: 'Lección 22 · Cortocircuitos: cómo se localizan (inyección de voltaje y cámara térmica)',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Una línea en cortocircuito es una de las fallas más frecuentes y difíciles de ubicar: puede haber cientos de componentes conectados a ella. Hoy vemos las ideas detrás de los métodos de localización y por qué algunos requieren práctica supervisada.'] },
    { t: 'Definición técnica', li: [
      '**Cortocircuito**: ruta de resistencia muy baja entre dos puntos que no deberían estar unidos, que origina un consumo excesivo. Una **fuga** es una resistencia baja pero no nula.',
      '**Cámara térmica** (termografía infrarroja): instrumento que muestra la temperatura de las superficies.',
      '**Inyección de voltaje**: aplicación controlada de energía desde una fuente de laboratorio a una línea con cortocircuito, con tensión y corriente limitadas, para ver qué componente se calienta o dónde cae la tensión.'] },
    { t: 'Explicación sencilla', p: ['Pasos habituales: 1) **identificar la línea** con el corto (modo diodo o resistencia hacia GND, comparando con otras líneas o con una placa buena); 2) revisar en el esquema qué componentes están conectados a esa línea; 3) **localizar** el punto: con cámara térmica o inyección, o **aislando** (retirando componentes sospechosos de a uno y midiendo de nuevo); 4) reemplazar y verificar.',
      'Causas frecuentes: un capacitor en cortocircuito, un MOSFET dañado, un chip o corrosión por líquidos.',
      '**Limitaciones:** la cámara térmica puede confundirse con superficies que reflejan, tiene poca resolución en componentes muy pequeños y el calor se propaga: **el punto más caliente no siempre es la causa raíz**. Un componente puede calentarse porque sufre el efecto del corto, no porque lo cause.',
      '**Inyección:** se aplica una tensión **no mayor que la nominal de la línea** y con límite de corriente. Aplicar más tensión o más corriente de la debida puede **destruir el procesador, el PCH y otros chips**. Por eso se reserva a **práctica supervisada** y solo con la línea y sus límites identificados.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Una rail de 3,3 V con corto: se mide contra GND, se compara con una placa buena y se confirma la diferencia. En el esquema se ve que decenas de capacitores y varios chips cuelgan de esa línea. Se energiza con corriente limitada y la cámara térmica muestra un capacitor caliente: se retira y se vuelve a medir; si el corto desaparece, se encontró la causa. Si no, se sigue investigando.'] }
  ],
  svg: flujo(['Medir|Ω / diodo', 'Identificar|la rail con corto', 'Localizar|calor o aislando', 'Reemplazar|y verificar'], 'El método importa más que cualquier instrumento'),
  svgPie: 'Diagrama ilustrativo de un método general.',
  foto: 'Fotografía de referencia pendiente: imagen de una cámara térmica sobre una placa (Wikimedia Commons: «thermal image circuit board»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Por qué el punto más caliente no siempre es la causa raíz de un corto?', a: 'Porque el calor se propaga y un componente puede calentarse por sufrir el efecto del corto (o por reflejos en el instrumento) sin ser quien lo causa. Hay que confirmar con medición y aislamiento.' }],
  resumen: 'Un cortocircuito se identifica midiendo, se localiza con calor, inyección controlada o aislando componentes, y se confirma con una nueva medición; la inyección de voltaje solo se practica con supervisión.',
  seguridad: 'No inyectes tensión sin identificar antes la línea y su límite: puedes destruir chips costosos. Nunca apliques una tensión mayor que la nominal de la línea ni una corriente sin límite.'
},

33: {
  titulo: 'Resumen semanal de electrónica — Semana 11',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['El diagnóstico va **del síntoma a la hipótesis y a la medición**.', 'El **consumo** de la fuente es una pista: nulo, estable, alto o que sube y baja.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['Un **cortocircuito** se identifica con modo diodo o resistencia y se localiza con calor, inyección o aislando.', 'La cámara térmica tiene límites: el punto más caliente no siempre es la causa.', 'La **inyección de voltaje** exige límites y práctica supervisada.'] },
    { t: 'Cómo se relacionan', p: ['El método del lunes dice qué hacer y en qué orden; el miércoles ofrece las técnicas para uno de los casos más difíciles. Ambos se basan en la misma idea: medir antes de cambiar piezas.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Árbol de decisión simple para el síntoma «no enciende»: 1) ¿Hay consumo? **No** → revisar entrada de energía. **Sí, estable y bajo** → revisar rails y señales de la secuencia. **Sí, alto o pegado al límite** → buscar un cortocircuito con el método de la lección 22. **Sube y baja** → buscar la primera etapa que no confirma (EN, PGOOD).'] }
  ],
  preguntas: [
    { q: '1) Consumo cero al conectar a la fuente: ¿por dónde empezarías?', a: 'Por la entrada de energía: cargador, conector, protecciones y MOSFET de entrada.' },
    { q: '2) Consumo alto y estable, pegado al límite: ¿qué hipótesis formularías?', a: 'Un cortocircuito en alguna línea; se identifica la rail con corto y se localiza el componente.' },
    { q: '3) ¿Por qué no se inyecta una tensión mayor que la nominal de la línea?', a: 'Porque puede destruir el procesador, el PCH y otros chips conectados a la línea.' }
  ],
  resumen: 'Adelanto de la semana 12, la última: reparación avanzada. Lunes 01-02: microsoldadura, pads y pistas. Miércoles 03-02: BGA, reballing y reflow.',
  seguridad: 'Recuerda: límite de corriente configurado, tensión nunca mayor que la nominal y práctica supervisada para la inyección.'
},

34: {
  titulo: 'Lección 23 · Microsoldadura, reparación de pads y pistas',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Diagnosticar bien no sirve si después se daña la placa al intervenirla. La microsoldadura es la habilidad práctica central del técnico electrónico. Hoy conocemos sus ideas básicas; se aprende practicando.'] },
    { t: 'Definición técnica', p: ['La **microsoldadura** es la soldadura y desoldadura de precisión de componentes pequeños, con control de temperatura, bajo microscopio y usando flux. Incluye la reparación de **pads** y **pistas** dañados.'] },
    { t: 'Explicación sencilla', p: ['Herramientas habituales: soldador regulable de punta fina, estación de aire caliente, **flux** (producto que limpia el óxido y ayuda a que la soldadura fluya), malla desoldadora, pinzas y microscopio. La soldadura puede ser con plomo o sin plomo: la sin plomo funde a mayor temperatura.',
      'Secuencia general para reemplazar un SMD: precalentar la zona, aplicar flux, calentar controlando tiempo y temperatura, retirar el componente, limpiar y estañar los pads, colocar el nuevo respetando orientación y valor, soldar, limpiar los residuos (con alcohol isopropílico) e inspeccionar con el microscopio.',
      'Riesgos: **levantar un pad** por exceso de calor o fuerza, dañar componentes vecinos o plásticos, crear puentes de soldadura entre pines y dejar soldaduras frías.',
      'Reparar una pista dañada: se retira la máscara de soldadura para exponer el cobre, se une con un cable muy fino y se suelda, se aísla la zona y se **verifica continuidad y aislamiento**.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Un conector de carga arrancó un pad de la placa. Se limpia la zona, se repara la pista con un cable fino, se aísla y se mide la continuidad desde el pad hasta el siguiente punto de la línea y que no exista continuidad hacia otras redes. Recién entonces se suelda el conector y se prueba el equipo con la fuente.',
      'Esta habilidad **se evalúa con una prueba práctica**: precisión, limpieza, pads intactos y componentes vecinos sin daño.'] }
  ],
  svg: flujo(['Precalentar', 'Flux y|calor', 'Retirar y|limpiar', 'Colocar|y soldar', 'Inspeccionar|y probar'], 'Control de temperatura y paciencia'),
  svgPie: 'Diagrama ilustrativo de un procedimiento general.',
  foto: 'Fotografía de referencia pendiente: microsoldadura bajo microscopio (Wikimedia Commons: «SMD rework», «hot air rework station»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Qué verificarías después de reparar una pista dañada?', a: 'Continuidad de extremo a extremo, aislamiento respecto de otras redes (sin cortos), inspección visual con microscopio y una prueba funcional con la fuente.' }],
  resumen: 'La microsoldadura combina temperatura controlada, flux y microscopio; al reparar una pista siempre se verifica continuidad y aislamiento, y se evalúa con práctica.',
  seguridad: 'Trabaja con ventilación o extracción de humos (el flux y la soldadura generan emanaciones), protege los ojos, cuida las quemaduras y mantén ordenado el puesto de trabajo. Practica primero en placas de descarte.'
},

35: {
  titulo: 'Lección 24 · BGA, reballing y reflow: cuándo sí y cuándo no',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Estas tres palabras se usan a menudo como si fueran una solución mágica. No lo son. Hoy aprendemos qué significa cada una y cuándo se justifica intervenir, porque es una de las preguntas que mejor distingue a un técnico serio.'] },
    { t: 'Definición técnica', li: [
      '**BGA** (Ball Grid Array): encapsulado de circuito integrado cuyas conexiones son pequeñas esferas de soldadura dispuestas en cuadrícula bajo el chip; los contactos no se ven.',
      '**Reflow**: proceso térmico controlado que vuelve a fundir las soldaduras, con un perfil de temperaturas (calentamiento, mantención y enfriamiento).',
      '**Reballing**: retirar el chip, limpiar, reponer las esferas de soldadura con una plantilla (stencil) y volver a soldarlo.'] },
    { t: 'Explicación sencilla', p: ['**BGA es un encapsulado, no un diagnóstico.** Decir «es el BGA» no explica nada. El reflow y el reballing solo corrigen **uniones de soldadura defectuosas** (por calor, golpes o flexión); **no corrigen un defecto interno del chip**.',
      'Se considera una intervención sobre un BGA cuando hay evidencia: síntomas que cambian con el calor o la presión, historial de una falla conocida del modelo, mediciones que apuntan a una conexión y, sobre todo, **descartadas otras causas** (alimentación, firmware, componentes cercanos). Calentar un chip sin diagnóstico previo no es una reparación confiable.',
      'Alternativa: **reemplazar el chip** por uno nuevo.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Intervenir un BGA implica calentar la placa y el chip varias veces, con riesgo de deformarla o dañar otros componentes. El resultado puede no ser duradero y debe explicarse al cliente. Requiere equipos con control de perfil térmico, precalentamiento inferior y microscopio.',
      'Un técnico serio puede explicar **por qué** eligió cada intervención y qué mediciones la respaldan.'] }
  ],
  svg: flujo(['Diagnóstico|previo y evidencia', 'Reflow', 'Reballing', 'Reemplazo|del chip'], 'De menos a más invasivo, y solo con evidencia'),
  svgPie: 'Diagrama ilustrativo; no implica que se deba pasar por todos los pasos.',
  foto: 'Fotografía de referencia pendiente: chip BGA visto desde abajo con sus esferas (Wikimedia Commons: «ball grid array», «BGA reballing»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Cómo confirmas que una falla corresponde realmente a una unión BGA?', a: 'Con evidencia: síntomas que dependen del calor o la presión, mediciones que apuntan a esa conexión, antecedentes del modelo y habiendo descartado antes la alimentación, el firmware y otros componentes. Un reflow o reballing no corrige defectos internos del chip.' }],
  resumen: 'BGA es un encapsulado, no un diagnóstico; el reflow y el reballing corrigen uniones de soldadura, no defectos internos, y solo se justifican con evidencia.',
  seguridad: 'El calor sobre chips y placas es una práctica de riesgo: se aprende con supervisión y equipo adecuado. No se recomienda improvisar con hornos domésticos ni pistolas de calor sin control de temperatura.'
},

36: {
  titulo: 'Resumen semanal de electrónica — Semana 12 · Cierre del programa',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['La **microsoldadura** exige control de temperatura, flux y microscopio.', 'Al reparar una pista se verifica **continuidad y aislamiento**.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['**BGA** es un encapsulado, no un diagnóstico.', '**Reflow** y **reballing** corrigen uniones de soldadura, no defectos internos, y requieren evidencia previa.'] },
    { t: 'Cómo se relacionan', p: ['Intervenir una placa es la última etapa de un proceso que comenzó con una medición. La calidad de la reparación depende del diagnóstico previo y de las pruebas posteriores.'] },
    { t: 'Pruebas finales antes de entregar un equipo', li: ['Encendido en frío y en caliente, y varios reinicios.', 'Carga con el adaptador original y con la batería (carga y descarga).', 'Pantalla, teclado, touchpad, puertos USB, audio, Wi-Fi y ventilador.', 'Temperatura y estabilidad bajo carga durante un tiempo prolongado.', 'Revisión visual final, limpieza y torque de tornillos.', 'Registro de diagnóstico, piezas usadas y fotos antes y después.'] },
    { t: 'Garantía', p: ['Se define por escrito qué cubre (la reparación realizada, no una falla independiente), por cuánto tiempo y bajo qué condiciones (por ejemplo, sin daño físico ni líquidos posteriores). Con el registro del diagnóstico es más fácil resolver cualquier reclamo.'] },
    { t: 'Checklist para evaluar a un técnico electrónico', li: ['Explica con hipótesis y mediciones, no solo con siglas.', 'Distingue memoria, protocolo y firmware (EEPROM, SPI, BIOS).', 'Sabe seguir una rail en un esquema y ubicarla con boardview.', 'Localiza cortocircuitos con método y conoce los riesgos de la inyección de voltaje.', 'Sabe cuándo NO hacer reballing ni reflow.', 'Aplica ESD y seguridad eléctrica.', '**Supera una prueba práctica**: reemplazar un SMD y diagnosticar una falla conocida.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué pruebas harías antes de entregar un equipo reparado?', a: 'Encendido y reinicios, carga con adaptador original y con batería, pantalla, teclado, puertos, audio, Wi-Fi, ventilador, temperatura bajo carga y revisión visual final, además de registrar el diagnóstico.' },
    { q: '2) Un técnico dice «es el BGA, hay que hacer reballing» sin haber medido nada. ¿Qué señal de alerta es esa?', a: 'Que propone una intervención de riesgo sin diagnóstico ni evidencia: BGA es un encapsulado, no un diagnóstico, y calentar un chip sin evidencia no es reparar.' },
    { q: '3) ¿Por qué se pide una prueba práctica a quien postula como técnico?', a: 'Porque conocer las siglas no demuestra que pueda reparar una placa: la microsoldadura y el diagnóstico se evalúan con la práctica.' }
  ],
  resumen: 'Este fue el último envío del programa de 12 semanas. Próxima etapa sugerida: diagnóstico de casos prácticos, marcas y modelos de notebooks, secuencias reales de encendido y análisis de fallas. Las páginas de estudio y la guía de 40 conceptos siguen disponibles en el ERP, en Servicio Técnico > Electrónica.',
  seguridad: 'Recuerda: las prácticas de riesgo (calor sobre chips, inyección de voltaje y programación de firmware) se aprenden con supervisión.'
}

};
