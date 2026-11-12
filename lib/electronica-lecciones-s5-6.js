// /lib/electronica-lecciones-s5-6.js
// Lecciones y resúmenes de las semanas 5 y 6 (envíos 13 a 18). Formato: ver lib/electronica-lecciones.js.
import { flujo } from './electronica-svg.js';

export const LECCIONES_S56 = {

13: {
  titulo: 'Lección 9 · DC-IN y adaptadores',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['La energía de un notebook empieza en el cargador y entra a la placa por un camino llamado DC-IN. Muchas fallas de «no enciende» se originan en ese tramo, antes de llegar a cualquier regulador. Hoy aprendemos a leerlo y a revisarlo.'] },
    { t: 'Definición técnica', p: ['**DC-IN** (entrada de corriente continua) es el conjunto de elementos por donde ingresa la energía continua a la placa: el conector de carga, las pistas, las protecciones, los filtros y los MOSFET de entrada.',
      'El **adaptador** (cargador) convierte la corriente alterna de la red en corriente continua de baja tensión. Su etiqueta indica la **tensión de salida** (V), la **corriente máxima** (A), la **potencia** (W) y la **polaridad** del conector.'] },
    { t: 'Explicación sencilla', p: ['Piensa en una puerta de entrada con varios guardias: conector, protección y MOSFET de entrada. Si uno falla, la energía no pasa. En un esquema, esta línea aparece con nombres como DC-IN, ADP o VIN: **el nombre depende del fabricante**.',
      'Para que un adaptador sea compatible, la **tensión debe coincidir** con la que pide el equipo y la **corriente (potencia) debe ser igual o mayor**; una potencia menor puede hacer que el equipo se limite o no cargue. Además, algunos fabricantes validan el adaptador con un pin o cable de datos: si no lo reconocen, pueden limitar la carga. Eso depende de la marca y del modelo.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Un equipo no responde al conectar el cargador y, en la fuente de laboratorio, no registra consumo. Primero se comprueba el propio cargador (tensión de salida). Luego se inspecciona el conector con el microscopio (pines flojos, soldaduras agrietadas, pistas levantadas), y se mide la tensión en cada punto del recorrido hacia los MOSFET de entrada: dónde llega y dónde desaparece indica dónde está el problema.',
      'Los conectores de carga reciben mucha fuerza mecánica; por eso son una causa muy frecuente de falla, y no siempre es un problema «electrónico» sino mecánico.'] }
  ],
  svg: flujo(['Cargador|V y A en etiqueta', 'Conector|DC-IN', 'Protección y|MOSFET de entrada', 'Rail principal|hacia reguladores'], 'La energía sigue un camino: si desaparece, ahí está la pista'),
  svgPie: 'Diagrama ilustrativo; los nombres de las líneas varían según el fabricante.',
  foto: 'Fotografía de referencia pendiente: conector de carga de un notebook y etiqueta de un adaptador (Wikimedia Commons: «laptop DC jack», «laptop power adapter label»). Registrar autor y licencia.',
  preguntas: [{ q: 'Si el equipo no consume nada al conectarlo, ¿qué revisarías entre el conector y los MOSFET de entrada?', a: 'Primero el cargador (tensión de salida) y su conector; luego el conector de la placa y sus soldaduras, las pistas, las protecciones y la tensión antes y después de cada elemento hasta los MOSFET de entrada.' }],
  resumen: 'El DC-IN es la puerta de entrada de la energía; si no hay consumo, se sigue el recorrido desde el cargador midiendo en cada tramo hasta ver dónde desaparece la tensión.',
  seguridad: 'Usa siempre un adaptador equivalente al original (tensión, potencia y polaridad). No fuerces conectores. Nunca abras un adaptador: contiene tensión de red.'
},

14: {
  titulo: 'Lección 10 · Power rails y líneas de espera (3VALW / 5VALW)',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Una vez que la energía entra a la placa, se reparte en varias «autopistas» de tensión llamadas rails. Hoy aprendemos qué son, cuáles deben estar presentes aunque el equipo esté apagado y por qué ese detalle es clave para diagnosticar.'] },
    { t: 'Definición técnica', p: ['Una **power rail** (línea de alimentación) es una red de la placa que distribuye una tensión específica, por ejemplo 5 V o 3,3 V, a los circuitos que la necesitan.',
      'Muchos esquemas llaman **3VALW** y **5VALW** a las líneas de 3,3 V y 5 V «**always**» (siempre presentes) o de espera: existen cuando hay energía conectada, incluso con el equipo apagado. Otras rails aparecen solo al encender, en etapas.'] },
    { t: 'Explicación sencilla', p: ['Es como una casa: algunas luces (la del pasillo, el refrigerador) están siempre encendidas y otras solo se encienden cuando llegas. Las rails de espera alimentan al EC y a los circuitos que deben estar listos para atender al botón de encendido o a la carga de la batería.',
      'Una precisión importante: **ese nombre es frecuente, pero no universal**. El sufijo ALW no garantiza el mismo comportamiento en todas las placas, y otros fabricantes usan otros nombres. En cada modelo se confirma en su esquema.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Con el cargador conectado y el equipo apagado, las rails de espera deberían estar presentes. Si faltan, la placa no puede ni iniciar su secuencia de encendido: es una de las primeras mediciones que se hacen (multímetro en V DC, punta negra a GND).',
      'Se mide **siguiendo el camino de la energía**: entrada, rails de espera, y después las demás. La primera línea ausente señala dónde buscar.'] }
  ],
  svg: flujo(['Entrada|DC-IN', 'Rails de espera|3VALW · 5VALW', 'EC|se alimenta de ellas', 'Rails de|encendido'], 'Las de espera existen con el equipo apagado; las demás aparecen al encender'),
  svgPie: 'Diagrama ilustrativo; los nombres de las rails dependen del fabricante.',
  foto: 'Fotografía de referencia pendiente: puntos de medición de tensión en una placa (Wikimedia Commons). Registrar autor y licencia.',
  preguntas: [{ q: '¿Por qué no todas las rails están presentes con el equipo apagado?', a: 'Porque solo las rails de espera necesitan existir para atender el botón de encendido y la carga; las demás se activan por etapas durante la secuencia de encendido.' }],
  resumen: 'Las rails distribuyen tensiones específicas; las de espera (como 3VALW/5VALW en muchos diseños) existen con el equipo apagado, pero los nombres y comportamientos dependen del modelo.',
  seguridad: 'Al medir rails con la placa energizada, evita que la punta de prueba toque dos pines a la vez (puede provocar un cortocircuito). Usa puntas finas y conecta primero la punta negra a GND.'
},

15: {
  titulo: 'Resumen semanal de electrónica — Semana 5',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['El **DC-IN** es el camino de entrada de la energía: conector, protecciones y MOSFET de entrada.', 'El adaptador debe coincidir en **tensión**, tener potencia suficiente y respetar la **polaridad**.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['Las **rails** distribuyen tensiones específicas por la placa.', 'Las de **espera** (ALW en muchos diseños) existen con el equipo apagado; los nombres varían según el fabricante.'] },
    { t: 'Cómo se relacionan', p: ['Forman la ruta de la energía: cargador, DC-IN, rails de espera y, después, el resto. Para diagnosticar, se mide en ese orden y se busca la **primera línea ausente**.'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['Un equipo no responde. En la fuente, no hay consumo. Se mide la tensión en el conector: llega. Se mide después de los MOSFET de entrada: no hay. El problema está entre ambos puntos. Si la tensión de entrada estuviera bien y faltara solo una rail de espera, la sospecha pasa al regulador que genera esa rail o a un cortocircuito en la propia línea.'] }
  ],
  preguntas: [
    { q: '1) Con el cargador conectado, falta 3VALW: ¿qué revisarías primero?', a: 'La tensión de entrada que llega al regulador de esa rail, el propio regulador y si la línea tiene un cortocircuito.' },
    { q: '2) ¿Qué significa ALW en muchas nomenclaturas?', a: 'Always: líneas que están presentes en espera, aun con el equipo apagado. La nomenclatura depende del fabricante.' },
    { q: '3) ¿Qué datos de la etiqueta del adaptador compararías con los que necesita el equipo?', a: 'Tensión de salida, corriente o potencia máxima y polaridad/tipo de conector.' }
  ],
  resumen: 'Adelanto de la semana 6: cómo se genera y se vigila una tensión. Lunes 21-12: convertidores Buck y Boost, y PWM. Miércoles 23-12: VRM, VCORE, EN y PGOOD.',
  seguridad: 'Recuerda: adaptador equivalente al original, punta negra a GND primero y cuidado de no unir pines con la punta.'
},

16: {
  titulo: 'Lección 11 · Convertidores Buck y Boost, y PWM',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['La placa necesita tensiones menores y a veces mayores que la del cargador, y las genera con convertidores conmutados. Hoy conocemos los dos tipos principales, Buck y Boost, y la técnica que los controla, el PWM.'] },
    { t: 'Definición técnica', li: [
      '**Convertidor DC-DC conmutado**: circuito que transforma una tensión continua en otra usando un interruptor (MOSFET) que se enciende y apaga muy rápido, un inductor y un capacitor.',
      '**Buck** (reductor): la tensión de salida es **menor** que la de entrada. **Boost** (elevador): la salida es **mayor**.',
      '**PWM** (Pulse Width Modulation, modulación por ancho de pulso): señal de pulsos de frecuencia fija cuyo ancho se varía. La proporción del tiempo en que el pulso está activo se llama **ciclo de trabajo** (duty cycle).'] },
    { t: 'Explicación sencilla', p: ['El MOSFET deja pasar energía en pulsos cortos; el inductor suaviza esos pulsos y el capacitor alisa la tensión. **Cuanto más ancho es el pulso, mayor es la tensión de salida.** En un Buck ideal, la salida es la entrada multiplicada por el ciclo de trabajo: con 20 V de entrada y un ciclo de 25 %, la salida es aproximadamente 5 V. En la práctica hay pérdidas, y el controlador ajusta el ciclo para mantener la tensión estable.',
      'No confundir con un **regulador lineal**, que baja la tensión «quemando» el exceso como calor: es más sencillo, pero menos eficiente.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['Una rail de 5 V o 3,3 V suele salir de un controlador que genera el PWM, dos MOSFET, una bobina y capacitores de salida: reconoceremos ese conjunto en cualquier placa. Los Boost aparecen, por ejemplo, en circuitos que alimentan la retroiluminación de algunas pantallas.',
      'Si falta el PWM no hay salida; si un MOSFET queda en corto, la salida se pierde y la entrada puede quedar en cortocircuito. Para ver el PWM se usa el osciloscopio. No todos los reguladores son iguales: la topología y el controlador dependen del modelo.'] }
  ],
  svg: flujo(['Entrada|ej. 20 V', 'MOSFET|conmuta (PWM)', 'Inductor|suaviza', 'Capacitor|alisa', 'Salida|menor (Buck)'], 'Buck: pulsos más anchos → más tensión de salida'),
  svgPie: 'Diagrama ilustrativo de un Buck; no es el esquema de un equipo real.',
  foto: 'Fotografía de referencia pendiente: bobina, MOSFET y capacitores de un regulador en una placa (Wikimedia Commons: «laptop motherboard voltage regulator»). Registrar autor y licencia.',
  preguntas: [{ q: '¿Cómo influye el ancho del pulso (PWM) en la tensión de salida de un convertidor Buck?', a: 'A mayor ancho de pulso (ciclo de trabajo), mayor tensión de salida; en un Buck ideal, la salida es la entrada por el ciclo de trabajo.' }],
  resumen: 'Un Buck reduce y un Boost eleva la tensión usando un MOSFET que conmuta; el ancho de los pulsos (PWM) fija la tensión de salida.',
  seguridad: 'Un regulador en funcionamiento puede tener MOSFET e inductores calientes: no los toques con la placa energizada. Evita unir con la punta de prueba el nodo de conmutación con otros pines.'
},

17: {
  titulo: 'Lección 12 · VRM, VCORE, EN y PGOOD',
  lectura: 5,
  bloques: [
    { t: 'Introducción', p: ['Una tensión no aparece «porque sí»: se enciende cuando recibe una orden y confirma que está bien con una señal. Hoy conocemos el regulador del procesador (VRM) y las dos señales de control más importantes de un regulador: EN y PGOOD.'] },
    { t: 'Definición técnica', li: [
      '**VRM** (Voltage Regulator Module): conjunto regulador (controlador, fases con MOSFET e inductores y capacitores) que entrega al procesador sus tensiones.',
      '**VCORE**: tensión de núcleo del procesador; su valor varía según el estado y la carga, y el procesador le indica al controlador qué valor necesita.',
      '**EN** (Enable): señal de habilitación que permite que un regulador se encienda.',
      '**PGOOD** (Power Good): señal que indica que la salida de un regulador está dentro del rango esperado.'] },
    { t: 'Explicación sencilla', p: ['Funciona como una cadena: se cumplen las condiciones previas → llega **EN** → el regulador arranca → confirma con **PGOOD** → se habilita la etapa siguiente. Cada eslabón depende del anterior.',
      'Las señales pueden ser de nivel alto o bajo según el diseño, y **los nombres y la lógica dependen del fabricante**. Un PGOOD bajo puede ser el **efecto** de una falla anterior, no la causa.'] },
    { t: 'Ejemplo aplicado a notebooks', p: ['No aparece VCORE. Antes de sospechar del VRM, se revisa: ¿tiene tensión de entrada? ¿recibe EN? ¿llegan los PGOOD de las etapas previas? ¿hay PWM? ¿hay un cortocircuito en la salida?',
      'Si el regulador **no recibe EN**, cambiarlo no soluciona nada: hay que averiguar quién genera esa señal (muchas veces el EC o una etapa anterior) y por qué no la entrega.'] }
  ],
  svg: flujo(['Condiciones|previas', 'EN|habilita', 'Regulador|arranca', 'PGOOD|«todo bien»', 'Siguiente|etapa'], 'Cada etapa espera a que la anterior confirme'),
  svgPie: 'Diagrama ilustrativo; la lógica exacta depende del fabricante y del modelo.',
  foto: 'Fotografía de referencia pendiente: zona del regulador del procesador en una placa (Wikimedia Commons). Registrar autor y licencia.',
  preguntas: [{ q: 'Si no aparece VCORE, ¿qué revisarías antes de sospechar del VRM?', a: 'Su tensión de entrada, la señal EN, los PGOOD de etapas previas, la presencia de PWM y si hay un cortocircuito en la salida. La ausencia de VCORE suele ser consecuencia de una secuencia detenida antes.' }],
  resumen: 'Un regulador arranca con EN y confirma con PGOOD; si falta una de esas señales, la causa suele estar en una etapa anterior, no necesariamente en el regulador.',
  seguridad: 'La zona del VRM maneja corrientes altas y se calienta. Mide con la placa energizada solo con puntas finas, evita unir pines y no inyectes tensión sin identificar la línea y su límite.'
},

18: {
  titulo: 'Resumen semanal de electrónica — Semana 6',
  lectura: 5,
  bloques: [
    { t: 'Lo que aprendimos el lunes', li: ['**Buck** reduce y **Boost** eleva la tensión.', 'El **PWM** controla el ancho de los pulsos del MOSFET y, con ello, la tensión de salida.'] },
    { t: 'Lo que aprendimos el miércoles', li: ['El **VRM** entrega al procesador su tensión (**VCORE**).', '**EN** habilita un regulador y **PGOOD** confirma que su salida está bien.'] },
    { t: 'Cómo se relacionan', p: ['El convertidor (Buck + PWM) es quien genera la tensión; EN y PGOOD son quienes lo encienden y lo vigilan. Para diagnosticar se pregunta en cada punto: «¿qué debería haber aquí y qué hay?».'] },
    { t: 'Ejemplo práctico que combina ambos temas', p: ['En un regulador de la placa, el controlador entrega PWM a los MOSFET y la bobina y los capacitores forman la salida. Se mide la entrada (presente), EN (presente), PWM (ausente). Conclusión de partida: el controlador no está generando pulsos; hay que ver su alimentación y las condiciones que le impiden arrancar, y recién después sospechar del propio chip.'] }
  ],
  preguntas: [
    { q: '1) ¿Qué diferencia hay entre un convertidor Buck y uno Boost?', a: 'El Buck entrega una tensión menor que la de entrada; el Boost, una mayor.' },
    { q: '2) ¿Qué indica la señal PGOOD?', a: 'Que la salida de un regulador está dentro del rango esperado (la señal que habilita la etapa siguiente).' },
    { q: '3) Un regulador no enciende porque su señal EN no llega: ¿lo reemplazarías de inmediato?', a: 'No: primero se averigua quién genera EN y por qué no la entrega. Cambiar el regulador no soluciona la causa.' }
  ],
  resumen: 'Adelanto de la semana 7: la energía y la batería. Lunes 28-12: baterías y circuito de carga. Miércoles 30-12: SMBus/I²C y USB-C Power Delivery.',
  seguridad: 'Recuerda: medir con puntas finas, no unir pines, y no inyectar tensión sin identificar la línea y su límite.'
}

};
