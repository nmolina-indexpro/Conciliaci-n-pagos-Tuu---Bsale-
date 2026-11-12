// /lib/electronica-lecciones-s3-4.js
// Lecciones y resúmenes de las semanas 3 y 4 (envíos 7 a 12). Formato: ver lib/electronica-lecciones.js.
import { flujo } from './electronica-svg.js';

export const LECCIONES_S34 = {

7: {
  titulo: 'Lección 5 · Transistores y MOSFET',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Hoy conocemos el componente más importante de la alimentación de un notebook: el MOSFET. Es un interruptor electrónico, y casi todo lo que sigue en el programa (entrada de energía, reguladores, carga) se apoya en él.'] },
    { t: 'Definición técnica', p: ['Un **transistor** es un dispositivo semiconductor de tres terminales que puede funcionar como interruptor o como amplificador. Un **semiconductor** es un material (como el silicio) cuya capacidad de conducir electricidad se puede controlar.',
      'El **MOSFET** (Metal-Oxide-Semiconductor Field-Effect Transistor) es un transistor cuyo terminal de control, la **compuerta** (**Gate**, G), regula con una tensión el paso de corriente entre el **drenador** (**Drain**, D) y la **fuente** (**Source**, S). Existen de **canal N** y de **canal P**.'] },
    { t: 'Explicación sencilla', p: ['Es una llave de agua que se abre o se cierra con una señal. Con el Gate «sin señal», la llave está cerrada y no pasa corriente de D a S. Con la señal adecuada, la llave se abre y la corriente fluye con muy poca resistencia. Para encenderse, el Gate necesita una tensión suficiente respecto a Source (la llamada tensión umbral): en un canal N, mayor; en un canal P, menor. Por esto la compuerta casi no consume corriente: solo «da la orden».',
      'Por construcción, la mayoría de los MOSFET de potencia traen un **diodo interno** entre Drain y Source que conduce en un sentido aunque el MOSFET esté apagado. Es algo que se debe recordar al medir (se verá en la práctica).'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['En la entrada de energía, uno o más MOSFET deciden si la energía del cargador pasa hacia la placa y hacia la batería. En los reguladores, otros MOSFET se encienden y apagan miles de veces por segundo para bajar la tensión (semana 6).',
      'Fallas típicas: un MOSFET **en cortocircuito** (D y S unidos) deja pasar energía donde no debe y genera consumo alto; uno **abierto** corta el paso y la línea queda sin tensión. Para confirmarlo se mide con el multímetro, pero ojo: **dentro de la placa las lecturas pueden estar alteradas por otros componentes conectados en paralelo**, así que una medida sola no condena a un MOSFET.'] }
  ],
  svg: '<svg viewBox="0 0 560 190" role="img" aria-label="Diagrama ilustrativo de un MOSFET con Gate, Drain y Source"><g font-family="Arial,sans-serif" font-size="13" fill="currentColor"><path d="M150 95 H200 M200 55 V135 M220 50 V70 M220 80 V110 M220 120 V140 M220 60 H300 V30 M220 130 H300 V160 M220 95 H270" stroke="currentColor" stroke-width="2.5" fill="none"/><text x="100" y="99" font-weight="bold">Gate (G)</text><text x="312" y="34" font-weight="bold">Drain (D)</text><text x="312" y="168" font-weight="bold">Source (S)</text><text x="400" y="80">Una señal en el Gate</text><text x="400" y="98">abre o cierra el paso</text><text x="400" y="116">de corriente entre D y S.</text></g></svg>',
  svgPie: 'Símbolo simplificado e ilustrativo (canal N); no es un esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: MOSFET SMD en una placa (Wikimedia Commons: «power MOSFET SMD»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Qué terminal controla el encendido de un MOSFET?', a: 'El Gate (compuerta): una tensión en él abre o cierra el paso de corriente entre Drain y Source.' }],
  resumen: 'El MOSFET es un interruptor controlado por la tensión del Gate; es la pieza base de la entrada de energía y de los reguladores, y medirlo dentro de la placa puede engañar por componentes en paralelo.',
  seguridad: 'La compuerta de un MOSFET es muy sensible a la electricidad estática (ESD): manipula las placas con protección antiestática, que estudiaremos en la semana 4. Los MOSFET de potencia pueden calentarse bastante durante el funcionamiento.'
},

8: {
  titulo: 'Lección 6 · Circuitos integrados, SMD y SMT',
  lectura: 4,
  bloques: [
    { t: 'Introducción', p: ['En una placa madre casi todo es diminuto y está soldado en la superficie. Hoy aprendemos qué es un circuito integrado, qué significan las siglas SMD y SMT (que suelen confundirse) y cómo leer la «cédula de identidad» de un chip.'] },
    { t: 'Definición técnica', li: [
      '**Circuito integrado** (**IC** o **CI**, también llamado «chip»): conjunto de componentes electrónicos fabricados en una pastilla de semiconductor y protegidos por un encapsulado con terminales (pines o bolas de soldadura).',
      '**SMD** (Surface-Mount Device): componente diseñado para soldarse sobre la superficie de la placa, sin atravesarla.',
      '**SMT** (Surface-Mount Technology): la tecnología o proceso de montaje de esos componentes.',
      'Como contraste, **THT** (Through-Hole Technology) es la tecnología de componentes con patas que atraviesan la placa.'] },
    { t: 'Explicación sencilla', p: ['**SMD es la pieza; SMT es la forma de montarla.** Es como la diferencia entre un ladrillo (la pieza) y la técnica de albañilería (el proceso).',
      'Cada circuito integrado trae impreso un código: marca, referencia y, a veces, fecha. Con ese código se busca su **hoja de datos** (datasheet), el documento del fabricante que describe qué hace cada pin. Un punto, un círculo o una esquina cortada marca el **pin 1**, que sirve para orientar el chip y leer el esquema sin equivocarse.',
      'Una precisión honesta: algunos fabricantes de equipos usan marcas propias o códigos internos, así que no siempre el código coincide con un documento público.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Los componentes pasivos (resistencias y capacitores) más pequeños de una placa pueden medir en torno a 1 mm o menos: por eso se trabaja con microscopio. Hay chips con los contactos visibles en sus bordes y otros con los contactos debajo (los BGA, que veremos en la semana 12).',
      'Al reemplazar un SMD hay que respetar su orientación y valor. Un chip montado al revés o un capacitor de valor incorrecto pueden causar nuevas fallas.'] }
  ],
  svg: flujo(['Componente|SMD', 'Tecnología de|montaje: SMT', 'Placa con|componentes montados'], 'SMD = la pieza · SMT = el proceso de montaje'),
  svgPie: 'Diagrama ilustrativo; no es una fotografía.',
  foto: 'Fotografía de referencia pendiente: circuito integrado con marcado y pin 1 (Wikimedia Commons: «integrated circuit SMD», «SOIC package»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Qué diferencia hay entre SMD y SMT?', a: 'SMD es el componente de montaje superficial (la pieza); SMT es la tecnología o proceso para montarlo (la técnica).' }],
  resumen: 'Un circuito integrado es un chip con su propio código; SMD es el componente de montaje superficial y SMT el proceso que lo monta; el pin 1 y el código permiten identificarlo y orientarlo.',
  seguridad: 'Manipula los chips por sus bordes y con protección ESD. Antes de reemplazar un componente, confirma orientación y valor en la documentación del equipo.'
},

9: {
  titulo: 'Resumen semanal de electrónica — Semana 3',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['El **transistor** puede actuar como interruptor o amplificador.', 'El **MOSFET** se controla con la tensión del **Gate** y abre o cierra el paso entre **Drain** y **Source**.', 'Dentro de la placa, la lectura de un MOSFET puede estar alterada por componentes en paralelo.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['Un **circuito integrado** (IC/CI) es un chip con código de identificación y pin 1.', '**SMD** es el componente de montaje superficial; **SMT** es la tecnología de montaje.', 'El código del chip permite buscar su hoja de datos, aunque algunas marcas son propias.'] },
    { t: 'Cómo se relacionan', p: ['El MOSFET y el circuito integrado son, en un notebook, componentes SMD montados con tecnología SMT. Por eso la primera habilidad para repararlos es reconocerlos físicamente, saber orientarlos y poder retirarlos y reemplazarlos con cuidado.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['En la entrada de energía de una placa verás uno o varios MOSFET SMD cerca del conector de carga. Cada uno tiene un código impreso; con él se busca su hoja de datos para saber cuál pin es Gate, Drain y Source.',
      'Si un MOSFET está en cortocircuito, la placa consumirá de más al conectarla. Pero antes de cambiarlo hay que confirmar con medición y descartar componentes en paralelo: **medir antes de reemplazar**.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué función cumple un MOSFET en la entrada de energía de un notebook?', a: 'Actúa como un interruptor controlado: decide si la energía del cargador pasa hacia la placa y la batería.' },
    { q: '2) ¿Qué diferencia hay entre SMD y SMT?', a: 'SMD es el componente de montaje superficial; SMT es la tecnología o proceso de montaje.' },
    { q: '3) ¿Para qué sirve el pin 1 de un circuito integrado?', a: 'Para orientar el chip y para leer correctamente la numeración de sus pines en la hoja de datos y el esquema.' }
  ],
  resumen: 'Adelanto de la semana 4: aprenderemos a proteger la placa y a medir. Lunes 07-12: ESD y multímetro. Miércoles 09-12: fuente regulable, microscopio y osciloscopio.',
  seguridad: 'Recuerda: protección antiestática, cuidado con las líneas energizadas y confirmación de orientación antes de reemplazar componentes.'
},

10: {
  titulo: 'Lección 7 · ESD y multímetro',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Antes de medir cualquier placa hay que protegerla, y antes de tocarla hay que aprender a medir. Hoy vemos cómo evitar dañar los componentes con electricidad estática (ESD) y cómo usar el multímetro, el instrumento más usado del taller.'] },
    { t: 'Definición técnica', li: [
      '**ESD** (Electrostatic Discharge): descarga electrostática, transferencia súbita de carga eléctrica entre dos objetos con distinta carga.',
      '**Multímetro**: instrumento que mide, según el modo, tensión (V) continua o alterna, resistencia (Ω), continuidad, caída de tensión en un diodo y, con precauciones, corriente (A).'] },
    { t: 'Explicación sencilla', p: ['Las personas solemos sentir una descarga estática solo sobre unos 3 000 V; muchos componentes pueden dañarse con valores bastante menores y **sin que lo notemos**. Por eso una falla por ESD puede aparecer después de la reparación.',
      'Medidas básicas: pulsera antiestática conectada a tierra, alfombra antiestática en la mesa de trabajo, bolsas antiestáticas para guardar placas, evitar ropa que genere estática y tocar la placa por los bordes.',
      'El multímetro se usa distinto según el modo. Con la placa **energizada** se mide tensión continua (**V DC**): punta negra a tierra (GND) y punta roja al punto a medir. Con la placa **sin energía** (cargador y batería desconectados) se mide resistencia, continuidad y el modo **diodo**, que entrega la caída de tensión y sirve para comparar una línea contra GND.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Para saber si una línea de alimentación tiene un cortocircuito, se mide con el modo diodo o resistencia entre la línea y GND, sin energía, y se compara con otra línea similar o con una placa del mismo modelo en buen estado. No existe un valor «normal» universal: la referencia es el mismo modelo.',
      'Para ver si una rail está presente, se energiza la placa y se mide en V DC. Si debería haber 3,3 V y se mide 0 V, la hipótesis es que la falla está antes de ese punto.'] }
  ],
  svg: flujo(['1. Protegerte|ESD', '2. Sin energía|Ω · continuidad · diodo', '3. Con energía|V DC'], 'Primero se protege la placa; después se mide, en el modo correcto'),
  svgPie: 'Diagrama ilustrativo; no es una fotografía de un instrumento real.',
  foto: 'Fotografía de referencia pendiente: multímetro digital y pulsera antiestática (Wikimedia Commons: «digital multimeter», «anti-static wrist strap»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Por qué no se debe medir resistencia en un circuito energizado?', a: 'Porque la tensión del propio circuito falsea la medición (el multímetro mide aplicando una pequeña corriente propia) y puede dañar el instrumento o el circuito.' }],
  resumen: 'La ESD puede dañar componentes sin que lo notemos, por eso se previene siempre; con el multímetro se mide tensión con la placa energizada y resistencia, continuidad y diodo con la placa sin energía.',
  seguridad: 'Nunca midas resistencia o continuidad con la placa energizada. No midas corriente conectando el multímetro en paralelo en modo corriente. Y nunca toques las partes internas de un cargador: tienen tensión de red (220 V).'
},

11: {
  titulo: 'Lección 8 · Fuente regulable, microscopio y osciloscopio',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Además del multímetro, el taller de electrónica necesita instrumentos para alimentar con seguridad una placa, ver lo que el ojo no alcanza y observar señales que cambian muy rápido. Hoy conocemos tres: la fuente regulable, el microscopio y el osciloscopio.'] },
    { t: 'Definición técnica', li: [
      '**Fuente regulable de laboratorio**: entrega una tensión continua ajustable y permite fijar un **límite de corriente**; muestra la tensión y la corriente consumida.',
      '**Microscopio estéreo**: instrumento con aumento y visión en profundidad para inspeccionar y trabajar sobre componentes diminutos.',
      '**Osciloscopio**: instrumento que muestra cómo cambia la tensión en el tiempo (eje horizontal = tiempo, eje vertical = tensión).'] },
    { t: 'Explicación sencilla', p: ['La **fuente regulable** reemplaza al cargador durante las pruebas. Si el consumo intenta superar el límite fijado, la fuente baja la tensión para no pasarse; así, un cortocircuito no destruye componentes de inmediato. Además, el consumo que muestra es una **pista de diagnóstico**. Un límite de corriente bajo **no reemplaza** el conocimiento de la línea: aplicar una tensión incorrecta puede dañar chips aunque la corriente sea baja.',
      'El **microscopio** permite ver soldaduras frías, pistas cortadas, corrosión por líquidos, componentes quemados o desplazados.',
      'El **osciloscopio** permite ver señales de reloj, PWM o ruido. El multímetro da un valor promedio; el osciloscopio muestra la forma. Importan la sonda, el cable de tierra corto y el ancho de banda (la capacidad de mostrar señales rápidas).'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Al conectar una placa que no enciende a la fuente: un consumo de cero indica que no hay camino de energía; un consumo estable muy alto o pegado al límite sugiere un cortocircuito; un consumo que sube y baja repetidamente sugiere que la placa intenta arrancar y se detiene. No hay números universales: la referencia es la experiencia con el mismo modelo.'] }
  ],
  svg: flujo(['Microscopio|ver', 'Fuente regulable|alimentar y limitar', 'Multímetro|medir', 'Osciloscopio|ver señales'], 'Cada instrumento responde una pregunta distinta'),
  svgPie: 'Diagrama ilustrativo; no es una fotografía de instrumentos reales.',
  foto: 'Fotografía de referencia pendiente: fuente de laboratorio, microscopio estéreo y osciloscopio (Wikimedia Commons). Registrar autor y licencia.',
  preguntas: [{ q: '¿Qué ventaja tiene una fuente regulable con límite de corriente sobre un cargador común al probar una placa? ¿Qué NO reemplaza?', a: 'Limita la corriente (un cortocircuito no destruye componentes de inmediato) y muestra el consumo como pista de diagnóstico. No reemplaza conocer la línea y su tensión correcta.' }],
  resumen: 'La fuente regulable alimenta y limita la corriente, el microscopio permite ver, y el osciloscopio muestra señales en el tiempo; el consumo que marca la fuente orienta el diagnóstico.',
  seguridad: 'Ajusta la tensión y el límite de corriente ANTES de conectar la placa. No uses una tensión mayor a la que corresponde a la entrada del equipo. Con el osciloscopio, conecta la tierra de la sonda a un punto de GND adecuado.'
},

12: {
  titulo: 'Resumen semanal de electrónica — Semana 4',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['La **ESD** puede dañar componentes sin avisar: se previene con pulsera, alfombra y manipulación cuidadosa.', 'El **multímetro** mide V DC (placa energizada) y resistencia, continuidad y diodo (placa sin energía).'] },
    { t: 'Lo que aprendimos el miércoles', li: ['La **fuente regulable** alimenta la placa con límite de corriente y muestra el consumo.', 'El **microscopio** permite inspeccionar y el **osciloscopio** muestra señales en el tiempo.'] },
    { t: 'Cómo se relacionan', p: ['Forman una secuencia de trabajo: primero se protege la placa (ESD), luego se inspecciona (microscopio), se mide sin energía (multímetro), se energiza con límite (fuente) y, solo si hace falta ver una señal, se usa el osciloscopio.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Llega un notebook que no enciende. 1) Pulsera ESD y mesa antiestática. 2) Inspección con microscopio del conector de carga. 3) Multímetro en modo diodo en la línea de entrada para descartar un corto. 4) Conexión a la fuente con límite de corriente y lectura del consumo. 5) Multímetro en V DC para ver si hay tensión en la entrada. 6) Osciloscopio solo si hay que verificar una señal.'] }
  ],
  preguntas: [
    { q: '1) Antes de medir resistencia en una placa, ¿qué se debe hacer con la energía?', a: 'Desconectar el cargador y la batería: la placa debe estar sin energía.' },
    { q: '2) Para ver si hay una señal de reloj, ¿usarías multímetro u osciloscopio? ¿Por qué?', a: 'Osciloscopio: muestra la forma de la señal en el tiempo; el multímetro solo da un valor promedio.' },
    { q: '3) ¿Para qué sirve el límite de corriente de la fuente regulable?', a: 'Para que un cortocircuito no destruya componentes de inmediato, y para observar el consumo como pista de diagnóstico.' }
  ],
  resumen: 'Adelanto de la semana 5: la ruta de la energía. Lunes 14-12: DC-IN y adaptadores. Miércoles 16-12: power rails y líneas de espera 3VALW/5VALW.',
  seguridad: 'Recuerda: ESD primero, sin energía para medir resistencia, y límite de corriente configurado antes de energizar.'
}

};
