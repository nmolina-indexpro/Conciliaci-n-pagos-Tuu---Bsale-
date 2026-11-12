// /lib/electronica-lecciones-s9-10.js
// Lecciones y resúmenes de las semanas 9 y 10 (envíos 25 a 30). Formato: ver lib/electronica-lecciones.js.
import { flujo } from './electronica-svg.js';

export const LECCIONES_S910 = {

25: {
  titulo: 'Lección 17 · EEPROM, SPI Flash y BIOS / UEFI',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Tres términos que suelen mezclarse: EEPROM, SPI y BIOS. Hoy los separamos: uno es un tipo de memoria, otro es un protocolo de comunicación y el tercero es un programa. Entenderlo evita errores graves al diagnosticar.'] },
    { t: 'Definición técnica', li: [
      '**Memoria no volátil**: conserva sus datos sin energía.',
      '**EEPROM** (Electrically Erasable Programmable Read-Only Memory): memoria no volátil que se borra y reescribe eléctricamente, normalmente de poca capacidad.',
      '**Memoria flash**: memoria no volátil de mayor capacidad, que se borra por bloques. Una **flash SPI** es una memoria flash que se comunica por el bus SPI.',
      '**SPI** (Serial Peripheral Interface): protocolo de comunicación serial. Sus líneas habituales son el reloj (SCK/CLK), dos de datos (entrada y salida) y la selección del chip (CS#); las memorias suelen sumar otras como WP# y HOLD#.',
      '**BIOS** (Basic Input/Output System) y **UEFI** (Unified Extensible Firmware Interface): firmware que inicializa el hardware y da inicio al arranque; UEFI es el sucesor moderno, con más capacidades. Muchos equipos actuales usan UEFI aunque se siga diciendo «BIOS».'] },
    { t: 'Explicación sencilla', p: ['Son tres capas: el **chip** (la memoria, por ejemplo una flash), el **«cable de datos»** (SPI, el protocolo) y el **programa** que se guarda ahí (BIOS/UEFI). SPI **no es una memoria**, y una EEPROM no es un protocolo: existen EEPROM con interfaz SPI o con interfaz I²C.',
      'En muchos notebooks la BIOS está en una flash SPI de pocos pines, pero **depende del diseño**: no toda EEPROM contiene la BIOS.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Un equipo muestra pantalla negra. Antes de sospechar de la BIOS se descartan alimentación, memoria RAM, pantalla y otras causas: **pantalla negra no significa BIOS dañada**. Hay señales que sí apuntan al firmware: el equipo enciende y se apaga en ciclos, el ventilador gira pero no hay arranque, o hubo una actualización interrumpida. Aun así se confirma con mediciones.'] }
  ],
  svg: flujo(['Procesador|o EC', 'Bus SPI|el «cable» de datos', 'Flash SPI|la memoria', 'BIOS / UEFI|el programa'], 'Memoria, protocolo y programa son tres cosas distintas'),
  svgPie: 'Diagrama ilustrativo; no es el esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: chip de memoria flash SPI de 8 pines en una placa (Wikimedia Commons: «SPI flash», «BIOS chip»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Por qué SPI no es una memoria y cuál es la diferencia con una EEPROM?', a: 'SPI es un protocolo de comunicación; una EEPROM es un tipo de memoria no volátil. Una memoria (como una flash o una EEPROM) puede comunicarse por SPI, pero SPI en sí no almacena datos.' }],
  resumen: 'La memoria (flash/EEPROM), el protocolo (SPI) y el programa (BIOS/UEFI) son tres cosas distintas; pantalla negra no implica necesariamente una BIOS dañada.',
  seguridad: 'Lee y respalda antes de modificar cualquier firmware. Una grabación errónea puede dejar la placa sin arranque: este tipo de intervención se practica con supervisión.'
},

26: {
  titulo: 'Lección 18 · Firmware del EC, volcados (dump) y programador SPI',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Cuando el diagnóstico apunta a un firmware dañado, hay que leer, respaldar y, si corresponde, grabar el contenido de una memoria. Es una de las tareas con mayor riesgo; por eso hoy aprendemos qué se verifica antes de tocar nada.'] },
    { t: 'Definición técnica', li: [
      '**Firmware**: programa grabado en una memoria no volátil que controla un chip. Hay firmware de la BIOS/UEFI, del EC y de otros chips (por ejemplo, controladores PD).',
      '**Volcado** (dump): copia binaria exacta del contenido de una memoria, normalmente un archivo .bin.',
      '**Programador SPI**: dispositivo que se conecta a un computador y permite **leer, escribir y verificar** memorias compatibles.'] },
    { t: 'Explicación sencilla', p: ['El firmware del EC puede estar en una memoria externa propia, compartida con la BIOS o dentro del propio chip EC (y en ese último caso **no siempre se puede programar desde afuera**).',
      'El volcado funciona como una «fotocopia de seguridad». Contiene datos únicos de cada placa (identificadores, número de serie, claves o licencias), por eso **un dump de otra placa no es un reemplazo universal** y puede traer problemas.',
      'Antes de grabar: 1) **identificar el modelo exacto del chip** por su código; 2) confirmar la **tensión de trabajo** (hay memorias de 3,3 V y de 1,8 V; usar la incorrecta puede dañarlas); 3) con la placa **sin energía** (cargador y batería desconectados); 4) leer **más de una vez** y comparar que los archivos coincidan; 5) **guardar el respaldo**; 6) grabar; 7) **verificar** lo grabado.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Para leer una memoria sin desoldarla se usa una pinza («clip»). Puede fallar: otros chips conectados al mismo bus interfieren, o la pinza no hace buen contacto. Cuando eso ocurre, a veces se retira la memoria o se conectan cables a los pines.',
      'Si no se puede leer de forma consistente, **no se graba**.'] }
  ],
  svg: flujo(['Respaldo|dump', 'Programador|SPI', 'Verificar|lectura', 'Grabar', 'Verificar|lo grabado'], 'Nunca se graba sin respaldo ni verificación'),
  svgPie: 'Diagrama ilustrativo de un procedimiento general; cada equipo tiene sus particularidades.',
  foto: 'Fotografía de referencia pendiente: programador SPI con pinza sobre una memoria (Wikimedia Commons: «SOIC clip programmer»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Qué verificarías antes de grabar una memoria de firmware?', a: 'El modelo exacto del chip, su tensión de trabajo, que la placa esté sin energía, que la lectura sea consistente (más de una vez), y que exista un respaldo del contenido original.' }],
  resumen: 'Antes de grabar un firmware se identifica el chip y su tensión, se respalda y se verifica; un dump ajeno puede traer datos únicos de otra placa.',
  seguridad: 'Esta es una práctica de riesgo: una tensión incorrecta puede dañar la memoria y una grabación errónea puede dejar la placa sin arranque. Se aprende con supervisión y con placas de práctica.'
},

27: {
  titulo: 'Resumen semanal de electrónica — Semana 9',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['**EEPROM** y **flash** son memorias no volátiles; **SPI** es un protocolo.', '**BIOS/UEFI** es el firmware que inicializa el hardware.', 'Pantalla negra no implica necesariamente una BIOS dañada.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['El **firmware** puede ser de la BIOS, del EC o de otros chips; el del EC no siempre es programable externamente.', 'Un **dump** es una copia exacta del contenido de la memoria; un **programador SPI** lee, escribe y verifica.', 'Antes de grabar: chip, tensión, respaldo y verificación.'] },
    { t: 'Cómo se relacionan', p: ['Primero se entiende qué es cada pieza (memoria, protocolo, programa) y recién después se interviene. La disciplina del respaldo y la verificación es la que evita convertir una falla recuperable en una irrecuperable.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Un equipo con pantalla negra: se confirma que las rails y la secuencia están correctas hasta el procesador; se lee la memoria con el programador, se compara con una segunda lectura, se revisa si el contenido parece íntegro (por ejemplo, lleno de valores vacíos o repetidos) y se compara con un firmware de referencia del modelo antes de decidir grabar.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué es un dump y por qué se hace antes de grabar?', a: 'Es una copia exacta del contenido de la memoria; sirve como respaldo para volver al estado original si algo sale mal.' },
    { q: '2) ¿Dónde puede estar el firmware del EC?', a: 'En una memoria externa propia, compartida con la BIOS o dentro del propio chip EC (en cuyo caso puede no ser programable desde afuera).' },
    { q: '3) Un equipo muestra pantalla negra: ¿qué descartarías antes de sospechar de la BIOS?', a: 'Alimentación y secuencia de encendido, memoria RAM, pantalla y conexiones; la pantalla negra tiene muchas causas distintas.' }
  ],
  resumen: 'Adelanto de la semana 10: la documentación. Lunes 18-01: schematic (esquema eléctrico). Miércoles 20-01: boardview, pads y pistas.',
  seguridad: 'Recuerda: respaldar, verificar y practicar con supervisión antes de grabar un firmware en una placa de un cliente.'
},

28: {
  titulo: 'Lección 19 · Schematic: el esquema eléctrico',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Sin un mapa, diagnosticar una placa es adivinar. El esquema eléctrico (schematic) es el mapa lógico de la placa: muestra qué conecta con qué. Hoy aprendemos a leerlo y a seguir una línea de alimentación.'] },
    { t: 'Definición técnica', p: ['El **schematic** (esquema eléctrico) es un diagrama lógico que representa los componentes mediante símbolos, sus conexiones (**nets** o redes), sus valores y los nombres de las señales. **No muestra dónde está cada pieza físicamente.**'] },
    { t: 'Explicación sencilla', p: ['Cada componente tiene un **designador**: una letra y un número. Las letras habituales son R (resistencia), C (capacitor), L (inductor), D (diodo), Q (transistor o MOSFET), U (circuito integrado), J (conector) y F (fusible). Por ejemplo, Q12 es el transistor número 12.',
      'Una **net** es un conjunto de puntos conectados eléctricamente entre sí y lleva un nombre, como 3VALW o PGOOD. Los esquemas suelen venir en varias páginas con referencias para saltar de una a otra, y a veces incluyen una página con el árbol de alimentación o la secuencia de encendido.',
      'Para **seguir una línea de alimentación**: se parte del consumidor, se busca su net, se avanza hasta el regulador que la genera y se revisa su entrada, su EN y su PGOOD.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Si falta la rail 3VALW, se busca su nombre en el esquema, se sigue hasta su regulador y se anotan sus señales: entrada, EN, PGOOD y salida. Con esa lista se sabe qué medir y en qué orden.',
      'Precauciones: **el esquema debe corresponder a la misma revisión de placa** que se tiene en la mesa, y los esquemas suelen proceder de fuentes no oficiales: pueden tener errores. Se verifican con mediciones.'] }
  ],
  svg: flujo(['Consumidor|ej. un chip', 'Net|ej. 3VALW', 'Regulador|que la genera', 'Entrada, EN|y PGOOD'], 'Se sigue la línea desde el consumidor hasta su origen'),
  svgPie: 'Diagrama ilustrativo; no es un esquema real.',
  foto: 'Fotografía o captura de referencia pendiente: página de un esquema eléctrico con sus símbolos (Wikimedia Commons: «schematic diagram»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Cómo seguirías una línea de alimentación desde un consumidor hasta su regulador?', a: 'Buscando el nombre de su net en el esquema, siguiéndola hasta el regulador que la genera y revisando entrada, señal EN, PGOOD y salida de ese regulador.' }],
  resumen: 'El esquema eléctrico es un mapa lógico: muestra qué conecta con qué mediante nets y designadores, no la posición física de las piezas.',
  seguridad: 'Confirma que el esquema sea de la misma revisión de tu placa y verifica con mediciones antes de reemplazar componentes basándote solo en él.'
},

29: {
  titulo: 'Lección 20 · Boardview, pads y pistas',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['El esquema dice qué conecta con qué, pero no dónde está cada pieza. El boardview responde a esa pregunta. Hoy aprendemos a usar ambos juntos y repasamos tres palabras del taller: pad, pista (trace) y vía.'] },
    { t: 'Definición técnica', li: [
      '**Boardview**: archivo y visor que muestran la placa físicamente: la ubicación de cada componente, de sus pads y de las pistas visibles; permite buscar por designador (por ejemplo Q12) o por net y resaltar todos los puntos de una red.',
      '**Pad**: superficie de cobre expuesta donde se suelda el terminal de un componente.',
      '**Trace** (pista): línea de cobre que une pads entre sí.',
      '**Vía**: orificio metalizado que conecta una capa de la placa con otra. Una placa de notebook es **multicapa**: no todo se ve desde afuera.'] },
    { t: 'Explicación sencilla', p: ['El esquema es el «mapa conceptual» y el boardview el «plano de la casa». Se usan **juntos**: se encuentra el componente en el esquema, se busca su designador en el boardview, se resalta la net y se elige un punto accesible para medir (un pad libre o un capacitor cercano).',
      'El boardview **no sustituye** al esquema: no muestra valores ni la lógica, y puede tener errores o corresponder a otra revisión de la placa.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Ejemplo ficticio: en el esquema, la señal PGOOD de un regulador sale del chip U10. En el boardview se busca U10, se resalta la net de PGOOD y se mide en un pad accesible. Si en el pad no hay señal pero sí en el pin del chip, la pista o una vía entre ambos puede estar dañada.'] }
  ],
  svg: flujo(['Esquema|qué conecta con qué', 'Boardview|dónde está', 'Punto de|medición', 'Medir y|comparar'], 'Los dos documentos se usan juntos'),
  svgPie: 'Diagrama ilustrativo; no es un boardview real.',
  foto: 'Fotografía o captura de referencia pendiente: placa con pads y pistas visibles (Wikimedia Commons: «printed circuit board traces», «via PCB»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Cómo encuentras en la placa física un MOSFET que aparece en el esquema?', a: 'Tomando su designador (por ejemplo Q12) del esquema, buscándolo en el boardview, que muestra su ubicación, y comprobando visualmente la pieza en la placa.' }],
  resumen: 'El boardview es el mapa físico de la placa y se usa junto al esquema; pad es el punto de soldadura, pista es el cobre que une pads y vía conecta capas.',
  seguridad: 'Verifica que el boardview corresponda a la revisión de tu placa. No raspes pistas ni levantes pads al medir; usa puntas finas.'
},

30: {
  titulo: 'Resumen semanal de electrónica — Semana 10',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['El **schematic** es el mapa lógico: nets, símbolos, designadores y señales.', 'Para seguir una rail: del consumidor al regulador, revisando entrada, EN y PGOOD.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['El **boardview** es el mapa físico: ubicación de componentes, pads y pistas.', '**Pad** = punto de soldadura; **trace** = pista de cobre; **vía** = conexión entre capas.'] },
    { t: 'Cómo se relacionan', p: ['Se usan en pareja: el esquema responde «qué» y el boardview responde «dónde». Con ambos se elige un punto de medición y se interpreta lo que se mide.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Ejercicio guiado con un esquema genérico: seguir la línea 3VALW desde un consumidor hasta su regulador, anotar sus señales (entrada, EN, PGOOD, salida), buscar el regulador en el boardview, identificar un punto de medición accesible y decidir qué se medirá primero y qué valor se espera encontrar.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué muestra y qué no muestra un esquema eléctrico?', a: 'Muestra componentes, conexiones y señales; no muestra la posición física de las piezas.' },
    { q: '2) ¿Para qué sirve el boardview?', a: 'Para ubicar físicamente los componentes y pads, y resaltar los puntos de una red para medir.' },
    { q: '3) ¿Qué es un pad y qué es una pista?', a: 'Un pad es la superficie de cobre donde se suelda un terminal; una pista es la línea de cobre que une pads.' }
  ],
  resumen: 'Adelanto de la semana 11: diagnóstico. Lunes 25-01: consumo anómalo y método de diagnóstico. Miércoles 27-01: localización de cortocircuitos.',
  seguridad: 'Recuerda: confirma la revisión de la placa y verifica con mediciones antes de reemplazar componentes.'
}

};
