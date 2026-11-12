// /lib/electronica-lecciones-s7-8.js
// Lecciones y resúmenes de las semanas 7 y 8 (envíos 19 a 24). Formato: ver lib/electronica-lecciones.js.
import { flujo } from './electronica-svg.js';

export const LECCIONES_S78 = {

19: {
  titulo: 'Lección 13 · Baterías y circuito de carga (charger IC)',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['El notebook puede funcionar con cargador, con batería o con ambos, y es el circuito de carga quien reparte la energía entre ellos. Hoy aprendemos cómo es una batería de notebook, qué hace el charger IC y por qué «no carga» tiene más de una causa posible.'] },
    { t: 'Definición técnica', li: [
      '**Batería de notebook**: pack de celdas de iones de litio (Li-ion) o de polímero de litio (Li-Po) con una electrónica de protección y gestión (**BMS**, Battery Management System) y un circuito que informa su estado. Cada celda tiene una tensión nominal cercana a 3,6–3,7 V; el pack suma celdas en serie.',
      '**Charger IC** (circuito integrado de carga): controlador que gestiona la energía entre el adaptador, el sistema y la batería.',
      '**Carga por etapas**: la batería se carga primero con corriente controlada y, al acercarse a su tensión máxima, con tensión constante y corriente decreciente.'] },
    { t: 'Explicación sencilla', p: ['El charger IC es un «semáforo de energía»: con cargador conectado, alimenta el sistema y, con lo que sobra, carga la batería; sin cargador, deja que la batería alimente el sistema. Para hacerlo, mide corriente y tensión, controla MOSFET y respeta los límites de temperatura y de potencia del adaptador.',
      'La batería incorpora su propia protección y se comunica con la placa (lo veremos el miércoles).'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['El equipo funciona con cargador pero no carga la batería. Hay dos grandes grupos de causas: **de la batería** (celdas degradadas, protección activada, comunicación defectuosa) o **de la placa** (charger IC, MOSFET, resistencias de medición, comunicación o EC). El primer paso es descartar la batería probando con otra buena y compatible.',
      'Que el equipo funcione solo con cargador y sin batería no indica por sí mismo una falla de la placa.'] }
  ],
  svg: flujo(['Adaptador|energía de entrada', 'Charger IC|reparte la energía', 'Sistema|placa y componentes', 'Batería|carga y descarga'], 'El charger IC decide hacia dónde va la energía'),
  svgPie: 'Diagrama ilustrativo; el diseño exacto cambia según el fabricante.',
  foto: 'Fotografía de referencia pendiente: batería de notebook y zona del circuito de carga (Wikimedia Commons: «laptop battery»). Registrar autor y licencia.',
  preguntas: [{ q: 'El equipo funciona con cargador pero no carga la batería: ¿qué dos grupos de causas distintos considerarías?', a: 'Causas de la batería (celdas degradadas, protección activada, comunicación) y causas de la placa (charger IC, MOSFET, resistencias de medición, comunicación o EC). Se parte descartando la batería con otra buena y compatible.' }],
  resumen: 'El charger IC reparte la energía entre adaptador, sistema y batería; ante un «no carga», hay que distinguir si la causa está en la batería o en la placa.',
  seguridad: 'Una batería de litio dañada es un riesgo de incendio: no la perfores, no la cortocircuites, no la cargues si está hinchada y no la abras. Guárdala lejos de materiales inflamables y deséchala en un punto autorizado.'
},

20: {
  titulo: 'Lección 14 · SMBus / I²C y USB-C Power Delivery',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Los chips de una placa no solo se alimentan: también «conversan». Hoy aprendemos dos formas de conversación que afectan a la energía: los buses SMBus e I²C, con los que se comunica la batería, y el protocolo USB-C Power Delivery, con el que un cargador negocia su tensión.'] },
    { t: 'Definición técnica', li: [
      '**I²C** (Inter-Integrated Circuit): bus serial de dos líneas, **SDA** (datos) y **SCL** (reloj), que comunica chips entre sí. Utiliza resistencias **pull-up** (resistencias que mantienen la línea en nivel alto cuando nadie la baja).',
      '**SMBus** (System Management Bus): bus basado en I²C con reglas eléctricas y de tiempo más estrictas, usado para sensores y baterías. Están relacionados, pero **no son idénticos**.',
      '**USB-C PD** (Power Delivery): protocolo por el que cargador y equipo acuerdan un perfil de tensión y corriente a través del conector USB-C.'] },
    { t: 'Explicación sencilla', p: ['**Batería inteligente:** informa al EC o al charger su carga, temperatura, ciclos e identificación. Si esa comunicación falla, el equipo puede mostrar «batería no detectada» o no cargarla. Si una línea del bus queda «pegada» en nivel bajo, ningún chip del bus puede hablar, y un componente defectuoso conectado al bus puede bloquearlo.',
      '**USB-C PD:** al conectar un cargador USB-C, si no hay negociación, entrega solo la tensión básica (5 V) con poca potencia. Con la negociación, se acuerda un perfil superior (los perfiles estándar usan, por ejemplo, 5, 9, 15 y 20 V; la extensión EPR llega a niveles mayores). La conversación ocurre por una línea de configuración del conector y la dirige un chip controlador PD en la placa. Los cables que soportan más de 3 A llevan un chip de identificación.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Un notebook USB-C que no carga con un cargador de teléfono puede estar funcionando normalmente: el cargador no ofrece un perfil adecuado. En cambio, uno que no carga con el cargador original puede tener un problema en el conector, en el cable, en el chip PD o en la línea de comunicación.',
      '**No todo cargador USB-C carga todo notebook**: importan la potencia, los perfiles soportados y las exigencias del fabricante.'] }
  ],
  svg: flujo(['Cargador|USB-C', 'Línea CC|negociación PD', 'Controlador PD|en la placa', 'Perfil de|tensión acordado'], 'Primero se negocia; después se entrega la tensión acordada'),
  svgPie: 'Diagrama ilustrativo; no es el esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: puerto USB-C de un notebook y cargador USB-C (Wikimedia Commons: «USB-C connector», «USB Power Delivery charger»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Por qué un cargador USB-C puede conectarse físicamente y aun así no alimentar el notebook?', a: 'Porque la entrega de tensión depende de la negociación PD y de la potencia: si no hay un perfil compatible, el cargador entrega solo la tensión básica o no alcanza la potencia que el notebook necesita.' }],
  resumen: 'La batería se comunica con la placa por SMBus/I²C, y un cargador USB-C negocia su tensión con el protocolo PD; sin esa comunicación, puede que no haya carga aunque haya conexión física.',
  seguridad: 'No uses cargadores USB-C de calidad dudosa con tensiones altas. Evita forzar el conector USB-C: es frágil. Trabaja siempre con la batería y el cargador desconectados al inspeccionar líneas de comunicación.'
},

21: {
  titulo: 'Resumen semanal de electrónica — Semana 7',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['La batería de notebook es un pack de celdas con protección (**BMS**).', 'El **charger IC** reparte la energía entre adaptador, sistema y batería, y carga por etapas.', 'Un «no carga» puede deberse a la batería o a la placa.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['**SMBus** e **I²C** son buses de dos líneas (datos y reloj) con los que se comunican chips y batería.', '**USB-C PD** negocia el perfil de tensión y potencia entre el cargador y el equipo.'] },
    { t: 'Cómo se relacionan', p: ['La energía no basta: también hace falta que los participantes se «entiendan». El charger IC necesita que la batería informe su estado y que el cargador entregue el perfil correcto; si falla la comunicación, falla la carga aunque haya energía física.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Tres casos: 1) **No carga con cargador original ni con otro:** se revisa la batería (probando con otra) y la comunicación. 2) **Carga lento:** puede ser un cargador de menor potencia o un perfil PD distinto del requerido. 3) **No negocia con USB-C:** se revisan el cable, el conector y el controlador PD.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué bus utiliza una batería inteligente para comunicarse con la placa?', a: 'Un bus SMBus (basado en I²C, de dos líneas: datos y reloj).' },
    { q: '2) ¿Qué hace el protocolo USB-C PD?', a: 'Negocia entre cargador y equipo el perfil de tensión y corriente que se entregará.' },
    { q: '3) Un equipo carga con otra batería pero no con la nueva: ¿cuál es tu primera hipótesis?', a: 'Un problema de la batería nueva (compatibilidad, protección o comunicación), antes de sospechar de la placa.' }
  ],
  resumen: 'Adelanto de la semana 8: el encendido. Lunes 04-01: EC/KBC y PCH. Miércoles 06-01: secuencia de encendido y estados de energía.',
  seguridad: 'Recuerda: las baterías de litio dañadas son un riesgo de incendio; no las perfores ni las cortocircuites.'
},

22: {
  titulo: 'Lección 15 · EC/KBC y PCH',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Cuando se aprieta el botón de encendido, no es el procesador quien despierta primero. Hoy conocemos al «director» que despierta a la placa, el EC, y al chip que administra gran parte de la comunicación con el resto del equipo, el PCH.'] },
    { t: 'Definición técnica', li: [
      '**EC** (Embedded Controller) o **KBC** (Keyboard Controller): microcontrolador de la placa que atiende el botón de encendido, el teclado, la carga de la batería, los ventiladores y los sensores de temperatura, y participa en el inicio de la secuencia de encendido. Funciona con una rail de espera y tiene su propio firmware.',
      '**PCH** (Platform Controller Hub): chip de plataforma (Intel) que concentra funciones de entrada y salida (USB, almacenamiento, audio, entre otras) y participa en los estados de energía. En otras plataformas esas funciones pueden estar integradas en el propio procesador (**SoC**, System on Chip) o en un chip equivalente.'] },
    { t: 'Explicación sencilla', p: ['El EC es como un guardia de turno que nunca duerme: está alimentado con la rail de espera y siempre atento al botón de encendido. Cuando se presiona, **inicia la secuencia**: activa las etapas de alimentación y se coordina con el PCH. Si el EC no funciona, la placa «no responde» aunque tenga energía.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Un equipo no responde al botón. Antes de afirmar que el EC está dañado, se comprueba: ¿tiene su alimentación de espera? ¿llega su señal de reset? ¿hay reloj? ¿lee correctamente su firmware? ¿se detecta la pulsación del botón? ¿hay un cortocircuito o calentamiento en el chip? **No se reemplaza un EC sin verificar su alimentación, reloj, reset y las señales relacionadas.**',
      'Una precisión: hay placas donde el EC o su firmware no se pueden programar externamente, y la arquitectura cambia según la marca, la plataforma y el modelo.'] }
  ],
  svg: flujo(['Botón de|encendido', 'EC / KBC|despierta la placa', 'Rails y|señales', 'PCH / CPU|arrancan'], 'El EC inicia la secuencia; el resto depende de él'),
  svgPie: 'Diagrama ilustrativo; la arquitectura exacta depende de la plataforma y del modelo.',
  foto: 'Fotografía de referencia pendiente: chip EC/KBC en una placa madre (Wikimedia Commons: «embedded controller laptop»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Qué señales y tensiones comprobarías antes de afirmar que el EC está dañado?', a: 'Su alimentación de espera, el reset, el reloj, la comunicación con su memoria de firmware, la señal del botón de encendido y si el chip se calienta de forma anormal. No se reemplaza sin verificar esas condiciones.' }],
  resumen: 'El EC atiende el botón de encendido y da inicio a la secuencia; el PCH administra gran parte de la entrada y salida; ambos dependen de la plataforma y del modelo.',
  seguridad: 'Al medir cerca del EC, ten cuidado con los pines muy cercanos entre sí: un cortocircuito accidental con la punta puede dañar el chip. Usa puntas finas y protección ESD.'
},

23: {
  titulo: 'Lección 16 · Secuencia de encendido y estados de energía (SLP_S3# / SLP_S4#)',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Encender una placa es una coreografía: cada paso depende de que el anterior haya ocurrido. Hoy aprendemos cómo se razona una secuencia de encendido y qué significan los estados de energía y las señales SLP.'] },
    { t: 'Definición técnica', li: [
      '**Secuencia de encendido** (power sequence): orden en que se habilitan las rails, las señales de control y los resets hasta que el sistema arranca.',
      '**Estados de energía** (estándar ACPI): **S0** equipo encendido, **S3** suspensión (la memoria sigue alimentada), **S4** hibernación, **S5** apagado «suave» y **G3** apagado mecánico (sin energía).',
      '**SLP_S3#** y **SLP_S4#** (SLP = sleep; el signo # indica que la señal es activa en nivel bajo): señales históricas de ciertas arquitecturas Intel que indican qué rails deben mantenerse o encenderse según el estado.'] },
    { t: 'Explicación sencilla', p: ['Una secuencia típica, de forma general: 1) hay energía y se activan las rails de espera; 2) el EC arranca; 3) se presiona el botón y el EC inicia el proceso; 4) se encienden rails intermedias; 5) las etapas confirman con PGOOD; 6) llegan las tensiones del procesador (VCORE); 7) se liberan los resets y arranca el firmware (BIOS/UEFI).',
      '**No existe una secuencia universal.** Cada fabricante, plataforma y generación tiene la suya, y los nombres de las señales cambian. Por eso la estrategia no es memorizar una lista, sino **localizar el primer paso que no ocurre**.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Se anotan, en orden, las señales y rails que deberían aparecer (según el esquema del modelo) y se mide cada una. La primera que falta marca el lugar donde buscar; las siguientes pueden estar ausentes como **consecuencia**, no como causa. Un PGOOD bajo, por ejemplo, suele ser efecto de algo anterior.'] }
  ],
  svg: flujo(['Rails de|espera', 'EC', 'Rails|intermedias', 'PGOOD', 'VCORE', 'Reset y|arranque'], 'Se busca el primer paso que no ocurre'),
  svgPie: 'Diagrama ilustrativo y genérico; la secuencia real depende de la plataforma.',
  foto: 'Fotografía de referencia pendiente: placa en medición de la secuencia de encendido (Wikimedia Commons). Registrar autor y licencia.',
  preguntas: [{ q: '¿Cómo localizas la primera condición ausente en una secuencia de encendido?', a: 'Anotando en orden las señales y rails que deberían aparecer según el esquema del modelo y midiéndolas una a una hasta encontrar la primera que falta; las posteriores suelen ser consecuencia.' }],
  resumen: 'La secuencia de encendido es una cadena de dependencias distinta en cada plataforma; se diagnostica encontrando el primer paso que no ocurre, no memorizando una lista.',
  seguridad: 'Al medir una secuencia con la placa energizada, utiliza una punta a la vez y evita puentear pines. No fuerces señales (por ejemplo, un enable) sin conocer el diseño: puede dañar chips.'
},

24: {
  titulo: 'Resumen semanal de electrónica — Semana 8',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['El **EC/KBC** atiende el botón de encendido, coordina la carga e inicia la secuencia.', 'El **PCH** (o el equivalente de cada plataforma) administra gran parte de la entrada y salida.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['La **secuencia de encendido** es una cadena de pasos que depende de cada plataforma.', 'Los **estados de energía** (S0, S3, S4, S5, G3) y las señales **SLP_S3# / SLP_S4#** indican qué debe estar encendido.'] },
    { t: 'Cómo se relacionan', p: ['El EC es el primer eslabón de la cadena y la secuencia es la cadena completa. Para diagnosticar se pregunta en cada punto: ¿qué necesita para ocurrir y recibió esas condiciones?'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Un equipo conectado no responde al botón. 1) Rails de espera: presentes. 2) EC alimentado: sí. 3) Señal del botón en el EC: no cambia al presionar. La hipótesis se acota: la falla está en el botón, en su conexión o en la entrada del EC, y aún no en las rails siguientes. Esto evita revisar a ciegas etapas que no han tenido oportunidad de activarse.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué diferencia hay entre los estados S0 y S3?', a: 'S0 es el equipo encendido y funcionando; S3 es suspensión, donde la memoria sigue alimentada.' },
    { q: '2) ¿Quién inicia normalmente la secuencia al presionar el botón de encendido?', a: 'El EC/KBC.' },
    { q: '3) ¿Existe una secuencia de encendido universal para todos los notebooks?', a: 'No: depende del fabricante, la plataforma y el modelo; por eso se localiza el primer paso que no ocurre en el esquema de cada equipo.' }
  ],
  resumen: 'Adelanto de la semana 9: memorias y firmware. Lunes 11-01: EEPROM, SPI Flash y BIOS/UEFI. Miércoles 13-01: firmware del EC, volcados y programador SPI.',
  seguridad: 'Recuerda: una señal a la vez con la punta, y no forzar señales sin conocer el diseño.'
}

};
