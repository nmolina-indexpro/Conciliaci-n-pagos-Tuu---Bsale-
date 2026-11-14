// /lib/electronica-componentes.js
// «Conoce el componente»: foto real, para qué sirve y fallas más comunes, que se muestran en las lecciones de Electrónica (correo y página).
// Los textos son generales (dependen del fabricante, la plataforma y el modelo). Las fotos vienen de Wikimedia Commons con licencia libre:
// lib/electronica-fotos.js (generado desde D:\Claude\academia-electronica\fotos\*.json) y los archivos en public/img-electronica/ (ruta pública, ver middleware.ts).
import { FOTOS } from './electronica-fotos.js';

// tipo: 'componente' (fallas en un notebook) o 'instrumento' (errores y problemas frecuentes al usarlo).
const C = {
  'cargador': { nombre: 'Cargador (adaptador AC/DC) de notebook', tipo: 'componente',
    funciones: ['Convierte la corriente alterna de la red en corriente continua de baja tensión.', 'Entrega la tensión, corriente y potencia que indica su etiqueta.', 'En algunas marcas incluye un pin o cable de datos con el que el equipo reconoce el adaptador.'],
    fallas: ['Cable dañado cerca del conector por doblez o tirones: carga intermitente.', 'Pin central desgastado o conector flojo.', 'Sin salida por una falla interna: no entrega tensión.', 'Potencia menor a la que pide el equipo, o adaptador no reconocido: el equipo limita la carga o no carga.'] },
  'resistencia-smd': { nombre: 'Resistencia SMD', tipo: 'componente',
    funciones: ['Limita la corriente que circula por un circuito.', 'Junto a otra resistencia, fija niveles de tensión (divisor de tensión).', 'Mantiene una línea en nivel alto o bajo cuando nadie la maneja (pull-up y pull-down).'],
    fallas: ['Quemada o abierta por una corriente excesiva: se ve oscurecida y deja de conducir.', 'Valor alterado por calor sostenido.', 'Soldadura fría o desprendida por golpes o flexión de la placa.', 'Rara vez falla sola: suele ser consecuencia de otra falla.'] },
  'capacitor-smd': { nombre: 'Capacitor cerámico SMD (MLCC)', tipo: 'componente',
    funciones: ['Filtra el ruido de una línea de alimentación (capacitor de desacople).', 'Almacena carga y estabiliza la tensión.', 'Entrega energía instantánea al chip que tiene al lado.'],
    fallas: ['En cortocircuito: une la línea a tierra, el consumo sube y la tensión no aparece (una de las causas más frecuentes).', 'Fisurado por golpes o por flexión de la placa.', 'Pérdida de capacidad o fugas: tensiones inestables y reinicios.', 'Desprendido por golpes.'] },
  'inductor-smd': { nombre: 'Inductor (bobina) SMD de potencia', tipo: 'componente',
    funciones: ['Almacena energía en un campo magnético.', 'Suaviza la corriente en los reguladores de tensión.', 'Ayuda a filtrar el ruido.'],
    fallas: ['Bobina cortada (sin continuidad): el regulador no entrega salida.', 'Sobrecalentada o quemada cuando un MOSFET en cortocircuito deja pasar demasiada corriente.', 'Fisurada o con soldaduras desprendidas por golpes.'] },
  'diodo-smd': { nombre: 'Diodo SMD', tipo: 'componente',
    funciones: ['Deja pasar la corriente en un solo sentido (ánodo a cátodo).', 'Protege contra polaridad invertida, sobretensiones y picos.', 'En su versión LED, emite luz como indicador.'],
    fallas: ['En cortocircuito: conduce en ambos sentidos y une la línea a tierra.', 'Abierto: no conduce y la línea queda sin tensión.', 'Dañado por sobretensión o descarga electrostática (ESD).', 'Instalado al revés al reemplazarlo.'] },
  'mosfet': { nombre: 'MOSFET de potencia SMD', tipo: 'componente',
    funciones: ['Actúa como interruptor controlado por la tensión de su Gate.', 'Decide si la energía del cargador pasa a la placa y a la batería.', 'Conmuta miles de veces por segundo en los reguladores de tensión.'],
    fallas: ['En cortocircuito entre Drain y Source: consumo alto y línea unida a la entrada o a tierra.', 'Abierto: la línea queda sin tensión.', 'Gate dañado por descarga electrostática (ESD) o sobretensión.', 'Quemado por corriente excesiva, o por corrosión tras derrames de líquidos.', 'Medirlo dentro de la placa puede engañar por componentes en paralelo.'] },
  'circuito-integrado': { nombre: 'Circuito integrado (IC) SMD', tipo: 'componente',
    funciones: ['Realiza una función completa: controlar, regular tensión, almacenar datos o comunicar.', 'Su código impreso permite buscar su hoja de datos.', 'El pin 1 permite orientarlo y leer el esquema sin equivocarse.'],
    fallas: ['Soldaduras frías o pines desprendidos por golpes o calor.', 'Quemado por un cortocircuito en la línea que alimenta.', 'Falla interna: no se corrige con reflow ni reballing.', 'Corrosión por líquidos o daño por descarga electrostática (ESD).'] },
  'multimetro': { nombre: 'Multímetro digital', tipo: 'instrumento',
    funciones: ['Mide tensión continua y alterna, resistencia, continuidad y caída en diodos.', 'Permite descubrir cortocircuitos comparando líneas.', 'Con precauciones, mide corriente.'],
    fallas: ['Fusible del rango de corriente quemado por medir corriente en un circuito conectado en paralelo.', 'Puntas dañadas u oxidadas que dan lecturas inestables.', 'Pila baja: lecturas erróneas.', 'Rango o modo equivocado (por ejemplo, medir resistencia con la placa energizada).'] },
  'pulsera-esd': { nombre: 'Pulsera antiestática', tipo: 'instrumento',
    funciones: ['Descarga de forma controlada la electricidad estática del cuerpo hacia tierra.', 'Evita dañar componentes sensibles al manipular placas.', 'Se usa junto con la alfombra antiestática del puesto de trabajo.'],
    fallas: ['No estar conectada a una tierra real: no protege.', 'Cable o clip roto u oxidado.', 'Correa floja o sin contacto con la piel.', 'Usarla solo a ratos o quitársela para «un trabajo rápido».'] },
  'fuente-lab': { nombre: 'Fuente de laboratorio regulable', tipo: 'instrumento',
    funciones: ['Entrega una tensión continua ajustable.', 'Limita la corriente para que un cortocircuito no destruya componentes de inmediato.', 'Muestra el consumo, que sirve como pista de diagnóstico.'],
    fallas: ['Límite de corriente mal ajustado (demasiado alto o demasiado bajo).', 'Tensión incorrecta para la entrada del equipo.', 'Cables o pinzas con mal contacto que dan lecturas falsas.', 'No notar que la fuente está limitando corriente (modo corriente constante).'] },
  'microscopio': { nombre: 'Microscopio estéreo', tipo: 'instrumento',
    funciones: ['Da aumento con visión en profundidad para trabajar con componentes diminutos.', 'Permite inspeccionar soldaduras, pistas, corrosión y componentes quemados.', 'Es la base de la microsoldadura.'],
    fallas: ['Iluminación insuficiente o que produce sombras.', 'Enfoque o distancia de trabajo mal ajustados: fatiga visual.', 'Demasiado aumento: se pierde la referencia de la placa.', 'Lentes sucios o rayados.'] },
  'osciloscopio': { nombre: 'Osciloscopio', tipo: 'instrumento',
    funciones: ['Muestra cómo cambia la tensión en el tiempo.', 'Permite revisar relojes, señales PWM y ruido.', 'Ayuda a verificar si un regulador está conmutando.'],
    fallas: ['Sonda en la escala equivocada (x1 o x10).', 'Cable de tierra de la sonda largo: introduce ruido en la medición.', 'Ancho de banda insuficiente para la señal.', 'Conectar la tierra de la sonda a un punto energizado distinto de GND: puede provocar un cortocircuito.'] },
  'conector-dc': { nombre: 'Conector de carga (DC jack) de notebook', tipo: 'componente',
    funciones: ['Recibe la energía del cargador y la lleva a la placa.', 'Sujeta mecánicamente el conector del cargador.', 'En algunos modelos incluye un pin de identificación del adaptador.'],
    fallas: ['Pin central flojo o desgastado: carga intermitente.', 'Soldaduras agrietadas por tirones del cable.', 'Pads o pistas levantados de la placa.', 'Conector roto por un golpe: el equipo no enciende al conectar el cargador.'] },
  'placa-notebook': { nombre: 'Placa madre de notebook', tipo: 'componente',
    funciones: ['Conecta y alimenta a todos los componentes del equipo.', 'Reparte la energía en distintas rails de tensión.', 'Aloja al EC, la memoria de firmware, el procesador y los reguladores.'],
    fallas: ['No enciende: sin consumo o con un cortocircuito en alguna línea.', 'No carga la batería.', 'Daño por líquidos y corrosión.', 'Soldaduras agrietadas por golpes o flexión.', 'Firmware corrupto: pantalla negra con el equipo encendido.'] },
  'regulador-buck': { nombre: 'Convertidor reductor (Buck)', tipo: 'componente',
    funciones: ['Reduce una tensión continua a otra menor con alta eficiencia.', 'Usa un MOSFET que conmuta bajo el control de una señal PWM.', 'Entrega una salida estable gracias a su bobina y sus capacitores.'],
    fallas: ['MOSFET en cortocircuito: se pierde la salida y la entrada puede quedar en corto.', 'Sin PWM: el controlador no arranca por falta de alimentación o de la señal EN.', 'Bobina cortada: no hay salida.', 'Capacitor de salida en cortocircuito: consumo alto o salida baja.'] },
  'vrm': { nombre: 'Regulador de voltaje del procesador (VRM)', tipo: 'componente',
    funciones: ['Entrega el voltaje de núcleo (VCORE) al procesador.', 'Reparte la corriente en varias fases con MOSFET e inductores.', 'Ajusta la tensión según la demanda del procesador.'],
    fallas: ['Sin VCORE por falta de entrada, de la señal EN o de PGOOD de etapas previas.', 'MOSFET de una fase en cortocircuito: consumo alto.', 'Controlador sin PWM.', 'Capacitores degradados: reinicios o apagados bajo carga.'] },
  'bateria-notebook': { nombre: 'Batería de notebook', tipo: 'componente',
    funciones: ['Alimenta el equipo cuando no hay cargador.', 'Almacena energía en celdas de iones de litio, protegidas por un sistema de gestión (BMS).', 'Informa su estado a la placa por un bus de comunicación (SMBus).'],
    fallas: ['Celdas degradadas: autonomía corta.', 'Protección activada por descarga profunda: no carga.', 'Batería hinchada: riesgo de incendio, no usar.', 'Comunicación fallida: «batería no detectada».', 'No cargar puede deberse también a la placa (circuito de carga).'] },
  'conector-usbc': { nombre: 'Conector USB-C', tipo: 'componente',
    funciones: ['Transfiere datos y energía.', 'Negocia la tensión de carga con el cargador (Power Delivery) por su línea de configuración.', 'En algunos equipos también entrega video.'],
    fallas: ['Pines doblados o con suciedad.', 'Soldaduras o anclajes agrietados por esfuerzo mecánico.', 'Chip controlador PD dañado: no negocia el perfil de tensión.', 'Cable o cargador sin el perfil adecuado: sin carga o carga lenta.'] },
  'ec-kbc': { nombre: 'Controlador embebido (EC/KBC)', tipo: 'componente',
    funciones: ['Atiende el botón de encendido y el teclado.', 'Coordina la carga de la batería, los ventiladores y los sensores de temperatura.', 'Da inicio a la secuencia de encendido de la placa.'],
    fallas: ['Sin alimentación de espera, reset o reloj: la placa no responde.', 'Firmware corrupto.', 'Dañado por un cortocircuito en su línea.', 'Teclado o touchpad sin respuesta, o ventilador siempre al máximo por lectura errónea de sensores.'] },
  'pch': { nombre: 'Chip de plataforma (PCH / chipset)', tipo: 'componente',
    funciones: ['Administra las entradas y salidas del equipo (USB, almacenamiento, audio, entre otras).', 'Participa en los estados de energía y en la secuencia de encendido.', 'En muchas placas gestiona el acceso a la memoria de la BIOS.'],
    fallas: ['Sin alguna de sus tensiones de alimentación.', 'Soldaduras agrietadas por calor o golpes.', 'Daño por una inyección de voltaje incorrecta.', 'Señales de estado ausentes: la secuencia de encendido no avanza.'] },
  'flash-spi': { nombre: 'Memoria flash SPI (BIOS/UEFI)', tipo: 'componente',
    funciones: ['Guarda el firmware que inicia el equipo (BIOS/UEFI) y, a veces, el del EC.', 'Conserva los datos sin energía.', 'Se lee cada vez que el equipo arranca.'],
    fallas: ['Firmware corrupto por una actualización interrumpida o un corte de energía.', 'Contenido borrado o vacío.', 'Chip dañado por programarlo con una tensión incorrecta.', 'Lecturas inconsistentes con la pinza por mal contacto.'] },
  'programador-spi': { nombre: 'Programador de memorias SPI', tipo: 'instrumento',
    funciones: ['Lee, respalda, escribe y verifica memorias de firmware.', 'Permite comparar lecturas para confirmar que son consistentes.', 'Se conecta con una pinza o con cables al chip.'],
    fallas: ['Tensión equivocada (3,3 V frente a 1,8 V) que daña la memoria.', 'Mala conexión de la pinza: lecturas distintas cada vez.', 'Otros chips del mismo bus que interfieren.', 'Grabar sin respaldar antes.'] },
  'esquema': { nombre: 'Esquema eléctrico (schematic)', tipo: 'instrumento',
    funciones: ['Es el mapa lógico de la placa: muestra qué conecta con qué.', 'Permite seguir una línea de alimentación hasta su regulador.', 'Identifica componentes con su designador y las redes con su nombre.'],
    fallas: ['Usar la revisión equivocada de la placa.', 'Errores en esquemas de fuentes no oficiales.', 'Confundirlo con la ubicación física de las piezas.', 'No seguir las referencias entre páginas.'] },
  'pcb-pads': { nombre: 'Pads, pistas y vías de una placa', tipo: 'componente',
    funciones: ['Los pads son los puntos de cobre donde se sueldan los componentes.', 'Las pistas (traces) unen los pads entre sí.', 'Las vías conectan una capa de la placa con otra.'],
    fallas: ['Pad levantado por exceso de calor o fuerza.', 'Pista cortada por un golpe, corrosión o raspado.', 'Vía oxidada o cortada.', 'Cortos entre pistas por residuos o líquidos.'] },
  'camara-termica': { nombre: 'Cámara térmica', tipo: 'instrumento',
    funciones: ['Muestra la temperatura de las superficies.', 'Ayuda a localizar componentes que se calientan por un cortocircuito.', 'Permite comparar con una placa buena del mismo modelo.'],
    fallas: ['Las superficies brillantes reflejan y engañan.', 'Baja resolución para componentes muy pequeños.', 'El punto más caliente no siempre es la causa.', 'Interpretar sin conocer la emisividad del material.'] },
  'estacion-retrabajo': { nombre: 'Estación de retrabajo SMD', tipo: 'instrumento',
    funciones: ['Suelda y desuelda con temperatura controlada.', 'El aire caliente permite retirar y colocar SMD y chips.', 'Se usa junto con flux y microscopio.'],
    fallas: ['Temperatura o tiempo excesivos: pads levantados y componentes vecinos dañados.', 'Flujo de aire muy alto: se mueven los componentes pequeños.', 'Puntas oxidadas que no transfieren bien el calor.', 'No precalentar la placa: se deforma.'] },
  'bga': { nombre: 'Chip BGA (Ball Grid Array)', tipo: 'componente',
    funciones: ['Conecta el chip a la placa mediante esferas de soldadura bajo su cuerpo.', 'Permite muchas conexiones en poco espacio.', 'Se usa en procesadores, chipsets, gráficos y memorias.'],
    fallas: ['Esferas agrietadas o soldaduras frías por calor, golpes o flexión: síntomas que cambian con el calor o la presión.', 'Daño interno del chip: no se corrige con reflow ni reballing.', 'Sobrecalentamiento por disipador o pasta térmica deficientes.', 'Calor repetido de intervenciones previas.'] },
};

// Qué componentes se muestran en cada envío (lección) del programa.
const POR_ENVIO = {
  1: ['cargador'], 2: ['resistencia-smd'], 4: ['capacitor-smd'], 5: ['inductor-smd', 'diodo-smd'], 7: ['mosfet'], 8: ['circuito-integrado'],
  10: ['multimetro', 'pulsera-esd'], 11: ['fuente-lab', 'microscopio', 'osciloscopio'], 13: ['conector-dc'], 14: ['placa-notebook'],
  16: ['regulador-buck'], 17: ['vrm'], 19: ['bateria-notebook'], 20: ['conector-usbc'], 22: ['ec-kbc'], 23: ['pch'], 25: ['flash-spi'], 26: ['programador-spi'],
  28: ['esquema'], 29: ['pcb-pads'], 31: ['fuente-lab'], 32: ['camara-termica'], 34: ['estacion-retrabajo'], 35: ['bga'],
};

// Componentes de un envío, con su foto si la hay: [{ slug, nombre, tipo, funciones, fallas, foto: { archivo, autor, licencia, licencia_url, pagina_url, descripcion } | null }]
export function componentesDeEnvio(n) {
  return (POR_ENVIO[n] || []).map(slug => ({ slug, ...C[slug], foto: FOTOS[slug] || null }));
}
export function todosLosComponentesPorEnvio() {
  const o = {};
  for (const n of Object.keys(POR_ENVIO)) o[n] = componentesDeEnvio(Number(n));
  return o;
}
export const SLUGS_COMPONENTES = Object.keys(C);
