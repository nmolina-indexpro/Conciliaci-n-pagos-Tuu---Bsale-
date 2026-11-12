// /lib/electronica-lecciones.js
// Contenido completo de las lecciones y resúmenes de Electrónica (Servicio Técnico), por número de envío
// de la grilla (electronica-datos.js). Semanas 1 y 2: envíos 1, 2, 3 (semana 1) y 4, 5, 6 (semana 2).
// Formato de cada entrada: { titulo, lectura, bloques:[{t, p:[párrafos] | li:[ítems]}], svg, svgPie, preguntas:[{q, a}], resumen, seguridad }
// Texto plano: **así** se muestra en negrita. El svg es un diagrama ILUSTRATIVO (no fotografía).
// Se sirve a la página (/api/negocio?recurso=electronica) y arma los correos de Usuarios > Notificaciones (lib/electronica-correo.js).
// Fotografías reales: pendientes de elegir en Wikimedia Commons y registrar autor y licencia (ver "foto" de cada entrada).
export const LECCIONES = {

1: {
  titulo: 'Lección 1 · ¿Qué es el voltaje?',
  lectura: 4,
  bloques: [
    { t: 'Introducción', p: ['Para comprender cómo funciona una placa madre, primero debemos entender qué es el voltaje y por qué cada componente necesita una tensión específica. Hoy también conocemos la «tierra» (GND): la referencia con la que se mide casi todo en electrónica.'] },
    { t: 'Definición técnica', p: ['El **voltaje** o tensión eléctrica (símbolo **V**, unidad: **volt**) es la diferencia de potencial eléctrico entre dos puntos de un circuito. Por eso siempre se mide «entre dos puntos», nunca «en uno solo».',
      'La **corriente continua** (**DC**, Direct Current) mantiene el mismo sentido y, en un circuito estable, un valor aproximadamente constante. La **corriente alterna** (**AC**, Alternating Current) cambia de sentido periódicamente: es la que entrega el enchufe de la pared.'] },
    { t: 'Explicación sencilla', p: ['Imagina dos estanques de agua a distinta altura unidos por una manguera. El agua se mueve porque hay una diferencia de «presión». El voltaje es esa diferencia de presión, pero para las cargas eléctricas.',
      'Cuando decimos «este punto tiene 3,3 V», en realidad queremos decir «este punto tiene 3,3 V **respecto a GND**». GND (del inglés ground, «tierra») es el punto de referencia del circuito, al que se le asigna 0 V. No siempre está conectado a la tierra física de la casa: es la referencia común de la placa.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['El enchufe entrega corriente alterna (220 V en Chile). El cargador la convierte en una corriente continua de baja tensión: típicamente 19 V o 20 V, según el modelo; lo dice su etiqueta.',
      'La placa madre no usa esa tensión directamente. Circuitos llamados **reguladores** la transforman en otras menores, por ejemplo 5 V, 3,3 V y las tensiones, aún más bajas, que necesita el procesador (cambian según el equipo y su estado).',
      'Esto ya sirve para diagnosticar: si en un punto debería haber 3,3 V y se mide 0 V, sabemos que algo falló antes de ese punto o en el propio punto. Aprenderemos a buscarlo semana a semana.'] }
  ],
  svg: '<svg viewBox="0 0 560 190" role="img" aria-label="Diagrama ilustrativo: el cargador entrega 20 V y los reguladores de la placa generan tensiones menores"><g font-family="Arial,sans-serif" font-size="13" fill="currentColor"><rect x="10" y="55" width="120" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><text x="70" y="82" text-anchor="middle">Cargador</text><text x="70" y="101" text-anchor="middle" font-weight="bold">20 V DC</text><path d="M130 85 H200" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M190 78 l12 7 -12 7" stroke="currentColor" stroke-width="2.5" fill="none"/><rect x="202" y="40" width="130" height="90" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><text x="267" y="82" text-anchor="middle">Reguladores</text><text x="267" y="101" text-anchor="middle">de la placa</text><path d="M332 55 H400 M332 85 H400 M332 115 H400" stroke="currentColor" stroke-width="2.5" fill="none"/><text x="410" y="59" font-weight="bold">5 V</text><text x="410" y="89" font-weight="bold">3,3 V</text><text x="410" y="119" font-weight="bold">Procesador (menor)</text><path d="M10 165 H550" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/><text x="10" y="182" opacity=".75">GND = 0 V (referencia común de todas las mediciones)</text></g></svg>',
  svgPie: 'Diagrama ilustrativo; no es una fotografía ni el esquema de un equipo real. Los valores varían según el modelo.',
  foto: 'Fotografía de referencia pendiente: etiqueta de un cargador de notebook (Wikimedia Commons: buscar «laptop power adapter»). Registrar autor y licencia al elegirla.',
  preguntas: [{ q: '¿Un procesador necesariamente funciona con el mismo voltaje que entrega el cargador?', a: 'No. La placa usa reguladores de voltaje para producir, a partir de los 19–20 V del cargador, las tensiones que necesita cada componente. Un procesador trabaja con tensiones mucho menores.' }],
  resumen: 'El voltaje es la diferencia de potencial entre dos puntos, se mide respecto a GND (0 V) y, en un notebook, el cargador entrega una tensión alta que la placa reduce con reguladores.',
  seguridad: 'Nunca abras un cargador ni manipules su entrada de red: ahí hay 220 V AC, que sí son peligrosos. Las tensiones de trabajo de la placa (19–20 V DC típicas) son bajas, pero un cortocircuito puede calentar y dañar componentes. Al manipular placas, sujétalas por los bordes y evita tocar los pines de los chips (la protección antiestática se estudia en la semana 4).'
},

2: {
  titulo: 'Lección 2 · Corriente, resistencia, ley de Ohm y potencia',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['El lunes vimos el voltaje: la «presión» eléctrica. Hoy sumamos las otras tres magnitudes que se usan en cada diagnóstico: la corriente, la resistencia y la potencia. Con ellas podremos interpretar, por ejemplo, por qué una placa con un cortocircuito se calienta.'] },
    { t: 'Definición técnica', li: [
      '**Corriente eléctrica** (símbolo **I**, unidad: **ampere**, A): cantidad de carga eléctrica que circula por un punto del circuito en cada segundo. 1 mA (miliampere) = 0,001 A.',
      '**Resistencia** (símbolo **R**, unidad: **ohm**, Ω): oposición que un elemento ofrece al paso de la corriente.',
      '**Ley de Ohm**: en un elemento resistivo, **V = I × R**. Despejando, **I = V ÷ R**.',
      '**Potencia eléctrica** (símbolo **P**, unidad: **watt**, W): energía por segundo que consume o entrega un circuito. **P = V × I**.'] },
    { t: 'Explicación sencilla', p: ['Volvamos a la manguera: el voltaje es la presión, la **corriente** es el caudal de agua que fluye y la **resistencia** es lo angosta que es la manguera. Con la misma presión, una manguera más angosta deja pasar menos agua; una muy ancha deja pasar mucha.',
      'La **potencia** es el «trabajo por segundo» del conjunto: más presión y más caudal significan más potencia. Esa potencia no desaparece: gran parte se convierte en calor. Por eso los componentes que consumen mucho se calientan.'] },
    { t: 'Un cálculo paso a paso', p: ['Un circuito de 5 V tiene una resistencia de 10 Ω. ¿Qué corriente circula?',
      'I = V ÷ R = 5 V ÷ 10 Ω = **0,5 A** (500 mA). Su potencia es P = V × I = 5 V × 0,5 A = **2,5 W**.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['La etiqueta de un cargador puede decir, por ejemplo, 20 V y 3,25 A: entrega como máximo unos 65 W (20 × 3,25). Si el notebook pide más potencia de la que el cargador puede dar, el equipo se limita o no enciende bien.',
      'Un **cortocircuito** es una ruta de resistencia muy baja entre dos puntos que no deberían estar unidos. Por la ley de Ohm, con una resistencia muy baja la corriente tiende a ser muy alta, y con ella la potencia y el calor. Por eso, cuando probemos placas, usaremos una fuente con límite de corriente (semana 4).',
      'Una precisión honesta: la ley de Ohm describe elementos resistivos. Los semiconductores (diodos, transistores, chips) no se comportan de forma tan lineal; los veremos más adelante.'] }
  ],
  svg: '<svg viewBox="0 0 560 190" role="img" aria-label="Diagrama ilustrativo: una fuente de voltaje V alimenta una resistencia R y circula una corriente I"><g font-family="Arial,sans-serif" font-size="13" fill="currentColor"><path d="M60 40 H260 M360 40 H480 V150 H60 V120 M60 70 V40" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M40 70 H80 M50 82 H70" stroke="currentColor" stroke-width="3" fill="none"/><path d="M60 82 V120" stroke="currentColor" stroke-width="2.5" fill="none"/><text x="10" y="102">V (fuente)</text><path d="M260 40 l15 -14 15 28 15 -28 15 28 15 -28 15 28 10 -14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linejoin="round"/><text x="310" y="22" text-anchor="middle" font-weight="bold">R (resistencia)</text><path d="M180 30 l20 10 -20 10" stroke="currentColor" stroke-width="2.5" fill="none"/><text x="150" y="26">I (corriente)</text><text x="500" y="75" font-weight="bold">V = I × R</text><text x="500" y="98" font-weight="bold">P = V × I</text></g></svg>',
  svgPie: 'Diagrama ilustrativo de un circuito simple; no es el esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: resistencia SMD sobre una placa y etiqueta de un cargador con V y A (Wikimedia Commons). Registrar autor y licencia al elegirla.',
  preguntas: [{ q: 'Si un circuito de 5 V tiene una resistencia de 10 Ω, ¿qué corriente circula?', a: 'I = V ÷ R = 5 ÷ 10 = 0,5 A (500 mA). La potencia es P = 5 × 0,5 = 2,5 W.' }],
  resumen: 'La corriente (A) resulta del voltaje (V) y la resistencia (Ω) según V = I × R, y la potencia (W) es P = V × I: un consumo alto implica calor.',
  seguridad: 'Una corriente alta con baja tensión también puede dañar: un cortocircuito en una placa o batería puede calentar, quemar componentes e incluso provocar un incendio. No cortocircuites baterías ni líneas de alimentación «para probar».'
},

3: {
  titulo: 'Resumen semanal de electrónica — Semana 1',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['El **voltaje** (V) es la diferencia de potencial entre dos puntos.', '**GND** es la referencia de 0 V; las tensiones se miden respecto a ella.', 'El cargador entrega **corriente continua (DC)** de baja tensión (19–20 V típicas) y la placa usa **reguladores** para obtener tensiones menores.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['La **corriente** (A) es el caudal de cargas; la **resistencia** (Ω) se opone a ella.', '**Ley de Ohm**: V = I × R (I = V ÷ R).', '**Potencia**: P = V × I; el consumo alto genera calor.'] },
    { t: 'Cómo se relacionan', p: ['El voltaje «empuja», la resistencia «frena» y de ambos resulta la corriente. Multiplicando voltaje y corriente obtenemos la potencia. Estas cuatro magnitudes siempre aparecen juntas: si conoces dos, puedes calcular las otras.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Un cargador dice 20 V y 3,25 A. Su potencia máxima es 20 × 3,25 = **65 W**.',
      'Supón que conectas ese cargador a una placa y esta consume 2 A: la potencia que toma es 20 × 2 = **40 W**, bien por debajo del máximo del cargador. Si, en cambio, la placa «pidiera» mucho más de lo que el cargador puede dar, el cargador no alcanzaría y el equipo no se comportaría con normalidad.',
      'Y si por un cortocircuito la resistencia en la placa fuera muy baja, la corriente tendería a ser muy alta y el calor también. Lo primero que se pregunta un técnico es: «¿cuánta corriente consume y cuánta debería consumir?».'] }
  ],
  preguntas: [
    { q: '1) Una placa recibe unos 20 V del cargador, pero un componente necesita una tensión menor. ¿Qué etapa se encarga de adaptarla?', a: 'Los reguladores de voltaje de la placa, que convierten la tensión del cargador en las tensiones que necesita cada componente.' },
    { q: '2) Si un circuito tiene 12 V y una resistencia de 4 Ω, ¿qué corriente circula?', a: 'I = V ÷ R = 12 ÷ 4 = 3 A.' },
    { q: '3) ¿Qué significa que una tensión se mida «respecto a GND»?', a: 'Que se mide entre ese punto y la referencia de 0 V del circuito (GND). Una tensión nunca se mide «en un punto aislado», sino entre dos puntos.' }
  ],
  resumen: 'Adelanto de la semana 2: conoceremos los componentes básicos de una placa: resistencias y capacitores (lunes 23-11), y diodos e inductores (miércoles 25-11). Retomarán lo que hoy repasamos: por ejemplo, un capacitor ayuda a mantener estable una tensión.',
  seguridad: 'Recuerda: no abras cargadores, no cortocircuites líneas ni baterías y sujeta las placas por los bordes.'
},

4: {
  titulo: 'Lección 3 · Resistencias y capacitores',
  lectura: 4,
  bloques: [
    { t: 'Introducción', p: ['Una placa madre tiene cientos de componentes diminutos, y la mayoría son de dos tipos: resistencias y capacitores. Hoy aprendemos para qué sirven, cómo se diferencian y por qué un capacitor defectuoso es una causa frecuente de fallas de alimentación.'] },
    { t: 'Definición técnica', li: [
      '**Resistencia** (resistor): componente que ofrece una oposición definida al paso de la corriente. Su valor se expresa en ohm (Ω), kiloohm (kΩ = 1 000 Ω) o megaohm (MΩ = 1 000 000 Ω). Se usa para limitar corriente y fijar niveles de tensión.',
      '**Capacitor** (o condensador): componente que almacena carga eléctrica entre dos placas conductoras separadas por un aislante. Su capacidad se mide en faradios (F); en la práctica se usan microfaradios (µF), nanofaradios (nF) y picofaradios (pF).'] },
    { t: 'Explicación sencilla', p: ['La resistencia es como un estrechamiento en una cañería: limita cuánta corriente pasa. No almacena nada y no tiene «lado correcto»: funciona igual en cualquier sentido.',
      'El capacitor es como un pequeño depósito de agua conectado a la cañería: cuando la presión sube un poco, se llena; cuando baja, se vacía y ayuda a mantenerla estable. Por eso se usa para **filtrar ruido** y estabilizar tensiones. Un capacitor deja pasar los cambios rápidos y «bloquea» la corriente continua estable.',
      'Detalle importante: algunos capacitores (por ejemplo los electrolíticos y varios tipos de gran capacidad) están **polarizados**: tienen un lado positivo y uno negativo y conectarlos al revés puede dañarlos. Los capacitores cerámicos pequeños que abundan en una placa normalmente no tienen polaridad.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Junto a cada chip importante verás varios capacitores diminutos que le suministran energía instantánea y filtran el ruido de su línea de alimentación. Se llaman capacitores de **desacople**.',
      'Un caso de falla muy conocido: un capacitor puede quedar en **cortocircuito**. Entonces la línea de alimentación a la que está conectado queda «unida» a tierra, el voltaje no sube y la placa puede consumir de más o no encender. No es la única causa posible, pero es de las primeras hipótesis que se investigan cuando una línea tiene un cortocircuito.',
      'Las resistencias, por su parte, rara vez fallan, pero pueden quemarse si circuló una corriente excesiva; entonces suelen verse oscurecidas o abiertas.'] }
  ],
  svg: '<svg viewBox="0 0 560 170" role="img" aria-label="Diagrama ilustrativo: símbolo de una resistencia y de un capacitor"><g font-family="Arial,sans-serif" font-size="13" fill="currentColor"><path d="M20 70 H70 l10 -22 20 44 20 -44 20 44 20 -44 10 22 H220" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linejoin="round"/><text x="120" y="120" text-anchor="middle" font-weight="bold">Resistencia (Ω)</text><text x="120" y="140" text-anchor="middle">limita la corriente</text><path d="M310 70 H360 M360 40 V100 M400 40 V100 M400 70 H450" stroke="currentColor" stroke-width="2.5" fill="none"/><text x="380" y="120" text-anchor="middle" font-weight="bold">Capacitor (F)</text><text x="380" y="140" text-anchor="middle">almacena carga y filtra ruido</text></g></svg>',
  svgPie: 'Símbolos ilustrativos; no son fotografías ni el esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: resistencias y capacitores SMD sobre una placa madre (Wikimedia Commons: «SMD resistor», «ceramic capacitor SMD»). Registrar autor y licencia al elegirla.',
  preguntas: [{ q: '¿Qué función cumple un capacitor conectado entre una línea de alimentación y tierra?', a: 'Almacena carga y filtra el ruido, estabilizando la tensión de esa línea y aportando energía instantánea al chip cercano. Si queda en cortocircuito, “une” la línea a tierra.' }],
  resumen: 'La resistencia limita la corriente; el capacitor almacena carga y estabiliza las tensiones, y un capacitor en cortocircuito es una causa frecuente de fallas de alimentación.',
  seguridad: 'Un capacitor grande puede conservar carga aun con el equipo desconectado. En placas de notebook las tensiones son bajas, pero no hagas cortocircuito entre terminales «para descargarlo»: esa práctica puede dañar el capacitor o la placa. Respeta la polaridad en capacitores polarizados.'
},

5: {
  titulo: 'Lección 4 · Diodos e inductores (bobinas)',
  lectura: 4,
  bloques: [
    { t: 'Introducción', p: ['Hoy conocemos dos componentes que parecen simples y que son el corazón de los reguladores de tensión: el diodo, que solo deja pasar la corriente en un sentido, y el inductor o bobina, que almacena energía en un campo magnético. También introducimos la idea de continuidad.'] },
    { t: 'Definición técnica', li: [
      '**Diodo**: componente semiconductor de dos terminales, **ánodo** y **cátodo**, que permite el paso de corriente principalmente en un sentido (del ánodo al cátodo). Cuando conduce, aparece sobre él una pequeña caída de tensión: en diodos de silicio comunes suele estar cerca de 0,7 V; en los diodos Schottky suele ser menor. Un **LED** es un diodo que emite luz.',
      '**Inductor** (bobina): componente que almacena energía en un campo magnético cuando circula corriente. Se opone a los cambios bruscos de corriente. Su unidad es el henrio (H); en una placa se ven valores en microhenrios (µH).',
      '**Continuidad**: existencia de un camino eléctrico sin interrupciones entre dos puntos, con resistencia muy baja. (Cómo se comprueba con un instrumento lo veremos en la semana 4.)'] },
    { t: 'Explicación sencilla', p: ['El diodo es como una **válvula antirretorno**: el agua pasa hacia un lado y el otro lado queda cerrado. En los diodos montados en superficie, una raya en uno de los extremos suele marcar el cátodo (con excepciones: siempre se confirma con la documentación).',
      'El inductor es como una **rueda pesada** en un circuito de agua: cuesta ponerla en movimiento y, una vez girando, tiende a seguir. Del mismo modo, el inductor «suaviza» los cambios de corriente. Una bobina en buen estado tiene continuidad entre sus extremos; si está cortada, la continuidad se pierde.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['En los reguladores de una placa verás bobinas pequeñas, cuadradas o rectangulares, junto a MOSFET, capacitores y un chip controlador: es la combinación que convierte 19–20 V en tensiones menores (lo estudiaremos en la semana 6).',
      'Los diodos aparecen en circuitos de protección y en la entrada de energía; muchos MOSFET incorporan además un diodo interno. Si una protección se daña, la línea que debía protegerse puede quedar sin tensión o en cortocircuito.'] }
  ],
  svg: '<svg viewBox="0 0 560 170" role="img" aria-label="Diagrama ilustrativo: símbolo de un diodo con ánodo y cátodo, y símbolo de un inductor"><g font-family="Arial,sans-serif" font-size="13" fill="currentColor"><path d="M20 70 H100 M100 40 V100 L150 70 Z M150 40 V100 M150 70 H230" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linejoin="round"/><text x="60" y="30" text-anchor="middle">ánodo (+)</text><text x="190" y="30" text-anchor="middle">cátodo (−)</text><text x="125" y="130" text-anchor="middle" font-weight="bold">Diodo</text><text x="125" y="150" text-anchor="middle">la corriente pasa en un sentido</text><path d="M310 70 H340 q0 -26 22 -26 q22 0 22 26 q0 -26 22 -26 q22 0 22 26 q0 -26 22 -26 q22 0 22 26 H470" stroke="currentColor" stroke-width="2.5" fill="none"/><text x="390" y="130" text-anchor="middle" font-weight="bold">Inductor (bobina)</text><text x="390" y="150" text-anchor="middle">almacena energía magnética</text></g></svg>',
  svgPie: 'Símbolos ilustrativos; no son fotografías ni el esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: bobinas (inductores) cerca de un regulador en una placa madre (Wikimedia Commons: «inductor SMD», «laptop motherboard VRM»). Registrar autor y licencia al elegirla.',
  preguntas: [{ q: '¿Qué ocurre, en condiciones normales, si un diodo se conecta con la polaridad invertida?', a: 'Bloquea el paso de la corriente. Por eso los diodos funcionan como «válvulas» de un solo sentido; la orientación (ánodo y cátodo) importa.' }],
  resumen: 'El diodo deja pasar la corriente en un solo sentido y el inductor almacena energía magnética y suaviza los cambios de corriente; ambos son piezas clave de los reguladores.',
  seguridad: 'Antes de reemplazar un diodo, confirma su orientación (ánodo/cátodo) en el esquema o con la documentación del equipo: instalarlo al revés puede dañar la placa. Las bobinas pueden calentarse en funcionamiento.'
},

6: {
  titulo: 'Resumen semanal de electrónica — Semana 2',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['La **resistencia** limita la corriente (se mide en Ω).', 'El **capacitor** almacena carga, filtra ruido y estabiliza tensiones (se mide en F, µF, nF, pF).', 'Un capacitor en **cortocircuito** une una línea a tierra y es una causa frecuente de fallas de alimentación.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['El **diodo** deja pasar la corriente en un solo sentido (ánodo → cátodo).', 'El **inductor** (bobina) almacena energía magnética y suaviza los cambios de corriente.', 'La **continuidad** es un camino eléctrico sin interrupciones entre dos puntos.'] },
    { t: 'Cómo se relacionan', p: ['Son los «ladrillos» de cualquier circuito de alimentación: la resistencia limita, el capacitor almacena y filtra, el diodo bloquea el sentido contrario y el inductor suaviza la corriente. Combinados, forman los filtros y reguladores que estudiaremos más adelante.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['En la salida de un regulador de la placa verás una **bobina** seguida de uno o varios **capacitores**. La bobina suaviza la corriente que llega en pulsos y los capacitores almacenan carga y alisan la tensión final. Es un filtro simple, y es el adelanto de lo que veremos con los convertidores Buck.',
      'Si en esa salida un capacitor queda en cortocircuito, la tensión no sube y el consumo puede ser alto. Y si la bobina está cortada, no hay continuidad y la energía no llega a la salida. Dos síntomas distintos, dos hipótesis distintas.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué componente almacena carga y filtra ruido en una línea de alimentación?', a: 'El capacitor (condensador).' },
    { q: '2) ¿Qué dos componentes forman un filtro de salida sencillo en un regulador?', a: 'Un inductor (bobina) y uno o varios capacitores: el inductor suaviza la corriente y los capacitores alisan la tensión.' },
    { q: '3) ¿Qué significa que haya continuidad entre dos puntos?', a: 'Que existe un camino eléctrico sin interrupciones entre ellos, con resistencia muy baja. Si una pista o bobina está cortada, se pierde la continuidad.' }
  ],
  resumen: 'Adelanto de la semana 3: veremos los semiconductores que controlan la energía: transistores y MOSFET (lunes 30-11), y circuitos integrados, SMD y SMT (miércoles 02-12). El MOSFET reaparecerá en casi todo lo que sigue.',
  seguridad: 'Recuerda: confirma la polaridad de diodos y capacitores polarizados antes de reemplazarlos y no cortocircuites líneas ni baterías.'
}

};
